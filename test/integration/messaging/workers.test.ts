import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import type { MessageQueue } from "../../../src/application/ports/message-queue";
import { PublishOutboxBatchUseCase } from "../../../src/application/publish-outbox/publish-outbox-batch.use-case";
import { ReprocessPendingReferenceUseCase } from "../../../src/application/reprocess-pending-reference/reprocess-pending-reference.use-case";
import { SubmitWagerTransactionUseCase } from "../../../src/application/submit-wager-transaction/submit-wager-transaction.use-case";
import { PENDING_REFERENCE_TTL_MS } from "../../../src/application/wager-processing/pending-reference-policy";
import { FailureCode } from "../../../src/domain/errors/failure-code";
import { Money } from "../../../src/domain/money/money";
import { OUTBOX_BACKOFF_CAP_MS } from "../../../src/domain/outbox/outbox-message";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../src/domain/transaction/transaction-status";
import type { Wallet } from "../../../src/domain/wallet/wallet";
import { loadConfig } from "../../../src/infrastructure/config/app-config";
import { createSqsClient } from "../../../src/infrastructure/messaging/sqs-client";
import { SqsMessageQueue } from "../../../src/infrastructure/messaging/sqs-message-queue";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { OutboxMessageSchema } from "../../../src/infrastructure/persistence/models/outbox-message.model";
import { WagerTransactionSchema } from "../../../src/infrastructure/persistence/models/wager-transaction.model";
import { UuidV7IdGenerator } from "../../../src/infrastructure/time/uuid-v7-id-generator";
import { drainPendingReferences } from "../../../src/interfaces/workers/pending-reference.tick";
import { FixedClock } from "../../support/fakes";
import { walletIn } from "../../support/sqs-fixture";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

const SCENARIO_TIMEOUT_MS = 30_000;
const client = createSqsClient(loadConfig(process.env).sqs);
const queue = new SqsMessageQueue(client);
let db: TestDatabase;
let eventsQueue: string;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.dispose();
});

async function withEventsQueue<T>(run: () => Promise<T>): Promise<T> {
  eventsQueue = `test-workers-${crypto.randomUUID()}`;
  await client.send(new CreateQueueCommand({ QueueName: eventsQueue }));
  try {
    return await run();
  } finally {
    await client.send(new DeleteQueueCommand({ QueueUrl: await queue.urlOf(eventsQueue) }));
  }
}

// SQS instável: uma em cada três publicações falha.
class FlakyQueue implements MessageQueue {
  private sends = 0;

  constructor(private readonly real: MessageQueue) {}

  receive: MessageQueue["receive"] = (name, options) => this.real.receive(name, options);
  ack: MessageQueue["ack"] = (name, handle) => this.real.ack(name, handle);
  changeVisibility: MessageQueue["changeVisibility"] = (name, handle, seconds) =>
    this.real.changeVisibility(name, handle, seconds);

  async send(name: string, message: Parameters<MessageQueue["send"]>[1]): Promise<void> {
    this.sends += 1;
    if (this.sends % 3 === 0) throw new Error("sqs throttled");
    await this.real.send(name, message);
  }
}

function betInput(wallet: Wallet, kind = TransactionKind.BET, reference: string | null = null) {
  const externalTransactionId = crypto.randomUUID();
  return {
    idempotencyKey: `provider-a:${externalTransactionId}`,
    providerId: "provider-a",
    externalTransactionId,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: "round-1",
    gameId: "game-1",
    kind,
    money: Money.from({ amount: "1.00", currency: "BRL" }),
    referenceExternalTransactionId: reference,
    context: { correlationId: "corr-workers", causationId: null },
  };
}

async function receivedEvents(): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  let empty = 0;
  while (empty < 2) {
    const messages = await queue.receive(eventsQueue, { maxMessages: 10, waitTimeSeconds: 1 });
    empty = messages.length === 0 ? empty + 1 : 0;
    for (const message of messages) {
      events.push(JSON.parse(message.body));
      await queue.ack(eventsQueue, message.receiptHandle);
    }
  }
  return events;
}

function pendingOutbox(): Promise<number> {
  return db.orm.em.fork().count(OutboxMessageSchema, { publishedAt: null });
}

describe("background workers against Postgres and LocalStack", () => {
  test(
    "two publishers on the same outbox publish every event and never get stuck",
    () =>
      withEventsQueue(async () => {
        const wallet = await walletIn(db, "100.00");
        const clock = new FixedClock(new Date());
        const unitOfWork = new MikroOrmUnitOfWork(db.orm);
        const submit = new SubmitWagerTransactionUseCase(
          unitOfWork,
          clock,
          new UuidV7IdGenerator(),
        );
        for (let index = 0; index < 10; index += 1) await submit.execute(betInput(wallet));
        const expectedIds = (
          await db.orm.em.fork().find(OutboxMessageSchema, { publishedAt: null })
        ).map((row) => row.id);
        const flaky = new FlakyQueue(queue);
        const publishers = [1, 2].map(
          () =>
            new PublishOutboxBatchUseCase(unitOfWork, flaky, clock, { eventsQueue, batchSize: 3 }),
        );

        for (let round = 0; round < 20 && (await pendingOutbox()) > 0; round += 1) {
          await Promise.all(publishers.map((publisher) => publisher.execute()));
          clock.advance(OUTBOX_BACKOFF_CAP_MS);
        }

        expect(await pendingOutbox()).toBe(0);
        const published = new Set((await receivedEvents()).map((event) => String(event.eventId)));
        for (const id of expectedIds) expect(published.has(id)).toBe(true);
      }),
    SCENARIO_TIMEOUT_MS,
  );

  test(
    "an exhausted reference ends REJECTED and its event is published",
    () =>
      withEventsQueue(async () => {
        const wallet = await walletIn(db, "100.00");
        const clock = new FixedClock(new Date());
        const ids = new UuidV7IdGenerator();
        const unitOfWork = new MikroOrmUnitOfWork(db.orm);
        const submit = new SubmitWagerTransactionUseCase(unitOfWork, clock, ids);
        const refund = betInput(wallet, TransactionKind.REFUND, `missing-${crypto.randomUUID()}`);
        await submit.execute(refund);
        const publisher = new PublishOutboxBatchUseCase(unitOfWork, queue, clock, {
          eventsQueue,
          batchSize: 50,
        });
        await publisher.execute();

        clock.advance(PENDING_REFERENCE_TTL_MS);
        await drainPendingReferences(
          new ReprocessPendingReferenceUseCase(unitOfWork, clock, ids),
          10,
        );
        await publisher.execute();

        const stored = await db.orm.em.fork().findOneOrFail(WagerTransactionSchema, {
          externalTransactionId: refund.externalTransactionId,
        });
        expect(stored.status).toBe(TransactionStatus.REJECTED);
        expect(stored.failureCode).toBe(FailureCode.REFERENCE_NOT_FOUND);
        const events = await receivedEvents();
        expect(events.map((event) => event.eventType)).toEqual([
          "WagerTransactionPendingReference",
          "WagerTransactionRejected",
        ]);
        expect(events[1]).toMatchObject({ data: { failureCode: FailureCode.REFERENCE_NOT_FOUND } });
      }),
    SCENARIO_TIMEOUT_MS,
  );
});
