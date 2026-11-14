import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import type {
  TransactionalRepositories,
  UnitOfWork,
} from "../../src/application/ports/unit-of-work";
import { PublishOutboxBatchUseCase } from "../../src/application/publish-outbox/publish-outbox-batch.use-case";
import { SubmitWagerTransactionUseCase } from "../../src/application/submit-wager-transaction/submit-wager-transaction.use-case";
import { Money } from "../../src/domain/money/money";
import { TransactionKind } from "../../src/domain/transaction/transaction-kind";
import { loadConfig } from "../../src/infrastructure/config/app-config";
import { createSqsClient } from "../../src/infrastructure/messaging/sqs-client";
import { SqsMessageQueue } from "../../src/infrastructure/messaging/sqs-message-queue";
import { MikroOrmUnitOfWork } from "../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { OutboxMessageSchema } from "../../src/infrastructure/persistence/models/outbox-message.model";
import { SystemClock } from "../../src/infrastructure/time/system-clock";
import { UuidV7IdGenerator } from "../../src/infrastructure/time/uuid-v7-id-generator";
import { RecordingLogger, RecordingMetrics } from "../support/fakes";
import { walletIn } from "../support/sqs-fixture";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

const BETS = 10;
const eventsQueue = `test-crash-${crypto.randomUUID()}`;
const client = createSqsClient(loadConfig(process.env).sqs);
const queue = new SqsMessageQueue(client);
const clock = new SystemClock();
let db: TestDatabase;

class ProcessDied extends Error {}

// O publisher envia ao SQS e o processo morre antes do COMMIT: a transação é desfeita e as
// linhas do outbox voltam a ficar pendentes, mas as mensagens já saíram.
class DiesBeforeCommit implements UnitOfWork {
  constructor(private readonly real: UnitOfWork) {}

  run<TResult>(
    work: (repositories: TransactionalRepositories) => Promise<TResult>,
  ): Promise<TResult> {
    return this.real.run(async (repositories) => {
      await work(repositories);
      throw new ProcessDied("killed before commit");
    });
  }
}

beforeAll(async () => {
  db = await createTestDatabase();
  await client.send(new CreateQueueCommand({ QueueName: eventsQueue }));
});

afterAll(async () => {
  await client.send(new DeleteQueueCommand({ QueueUrl: await queue.urlOf(eventsQueue) }));
  await db.dispose();
});

function publisher(unitOfWork: UnitOfWork): PublishOutboxBatchUseCase {
  return new PublishOutboxBatchUseCase(
    unitOfWork,
    queue,
    clock,
    { eventsQueue, batchSize: 50 },
    { logger: new RecordingLogger(), metrics: new RecordingMetrics() },
  );
}

async function fillOutbox(): Promise<void> {
  const wallet = await walletIn(db, "100.00");
  const submit = new SubmitWagerTransactionUseCase(
    new MikroOrmUnitOfWork(db.orm),
    clock,
    new UuidV7IdGenerator(),
  );
  for (let index = 0; index < BETS; index += 1) {
    const externalTransactionId = crypto.randomUUID();
    await submit.execute({
      idempotencyKey: `provider-a:${externalTransactionId}`,
      providerId: "provider-a",
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: TransactionKind.BET,
      money: Money.from({ amount: "1.00", currency: "BRL" }),
      referenceExternalTransactionId: null,
      context: { correlationId: "corr-crash", causationId: null },
    });
  }
}

async function receivedBodies(): Promise<string[]> {
  const bodies: string[] = [];
  let empty = 0;
  while (empty < 2) {
    const messages = await queue.receive(eventsQueue, { maxMessages: 10, waitTimeSeconds: 1 });
    empty = messages.length === 0 ? empty + 1 : 0;
    for (const message of messages) {
      bodies.push(message.body);
      await queue.ack(eventsQueue, message.receiptHandle);
    }
  }
  return bodies;
}

describe("two publishers on the same outbox after a crash before commit", () => {
  test("no event is lost and every duplicate is identical by eventId", async () => {
    await fillOutbox();
    const expected = (await db.orm.em.fork().find(OutboxMessageSchema, {})).map((row) => row.id);
    const real = new MikroOrmUnitOfWork(db.orm);

    await expect(publisher(new DiesBeforeCommit(real)).execute()).rejects.toThrow(ProcessDied);
    expect(await db.orm.em.fork().count(OutboxMessageSchema, { publishedAt: null })).toBe(
      expected.length,
    );
    const survivors = [publisher(real), publisher(real)];
    await Promise.all(survivors.map((survivor) => survivor.execute()));

    expect(await db.orm.em.fork().count(OutboxMessageSchema, { publishedAt: null })).toBe(0);
    const bodies = await receivedBodies();
    const byEventId = new Map<string, Set<string>>();
    for (const body of bodies) {
      const eventId = String(JSON.parse(body).eventId);
      byEventId.set(eventId, (byEventId.get(eventId) ?? new Set()).add(body));
    }
    expect([...byEventId.keys()].sort()).toEqual([...expected].sort());
    expect(bodies.length).toBe(expected.length * 2);
    for (const copies of byEventId.values()) expect(copies.size).toBe(1);
  }, 30_000);
});
