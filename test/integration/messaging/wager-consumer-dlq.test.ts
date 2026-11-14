import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import { ConnectionException } from "@mikro-orm/postgresql";
import { AbandonWagerMessageUseCase } from "../../../src/application/abandon-wager-message/abandon-wager-message.use-case";
import { ConsumeWagerMessageUseCase } from "../../../src/application/consume-wager-message/consume-wager-message.use-case";
import { CreateWalletUseCase } from "../../../src/application/create-wallet/create-wallet.use-case";
import type { UnitOfWork } from "../../../src/application/ports/unit-of-work";
import { FailureCode } from "../../../src/domain/errors/failure-code";
import { Money } from "../../../src/domain/money/money";
import { TransactionStatus } from "../../../src/domain/transaction/transaction-status";
import { loadConfig } from "../../../src/infrastructure/config/app-config";
import { createSqsClient } from "../../../src/infrastructure/messaging/sqs-client";
import { SqsMessageQueue } from "../../../src/infrastructure/messaging/sqs-message-queue";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { WagerTransactionSchema } from "../../../src/infrastructure/persistence/models/wager-transaction.model";
import { SystemClock } from "../../../src/infrastructure/time/system-clock";
import { UuidV7IdGenerator } from "../../../src/infrastructure/time/uuid-v7-id-generator";
import { WagerMessageConsumer } from "../../../src/interfaces/sqs/wager-message.consumer";
import { RecordingLogger } from "../../support/fakes";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

const suffix = crypto.randomUUID();
const mainQueue = `test-main-${suffix}.fifo`;
const deadLetterQueue = `test-dlq-${suffix}.fifo`;
const client = createSqsClient(loadConfig(process.env).sqs);
const queue = new SqsMessageQueue(client);
const clock = new SystemClock();
const ids = new UuidV7IdGenerator();
let db: TestDatabase;

// Simula o banco fora do ar para o processamento; o registro do FAILED usa o banco real.
class UnavailableUnitOfWork implements UnitOfWork {
  run<TResult>(): Promise<TResult> {
    return Promise.reject(new ConnectionException(new Error("ECONNREFUSED")));
  }
}

beforeAll(async () => {
  db = await createTestDatabase();
  for (const name of [mainQueue, deadLetterQueue]) {
    await client.send(
      new CreateQueueCommand({ QueueName: name, Attributes: { FifoQueue: "true" } }),
    );
  }
});

afterAll(async () => {
  for (const name of [mainQueue, deadLetterQueue]) {
    await client.send(new DeleteQueueCommand({ QueueUrl: await queue.urlOf(name) }));
  }
  await db.dispose();
});

function consumerWith(processing: UnitOfWork, maxReceives: number): WagerMessageConsumer {
  const real = new MikroOrmUnitOfWork(db.orm);
  return new WagerMessageConsumer(
    {
      queue,
      consume: new ConsumeWagerMessageUseCase(processing, clock, ids),
      abandon: new AbandonWagerMessageUseCase(real, clock, ids),
      clock,
      logger: new RecordingLogger(),
    },
    {
      queueName: mainQueue,
      deadLetterQueueName: deadLetterQueue,
      consumerName: "wager-transactions-consumer",
      maxReceives,
    },
  );
}

async function enqueue(body: string): Promise<void> {
  await queue.send(mainQueue, {
    body,
    groupId: "group-1",
    deduplicationId: crypto.randomUUID(),
  });
}

async function drainDeadLetters(): Promise<Record<string, unknown>[]> {
  const messages = await queue.receive(deadLetterQueue, { maxMessages: 10, waitTimeSeconds: 2 });
  for (const message of messages) await queue.ack(deadLetterQueue, message.receiptHandle);
  return messages.map((message) => JSON.parse(message.body));
}

describe("wager consumer DLQ against LocalStack and Postgres", () => {
  test("a malformed message ends in the DLQ with its reason", async () => {
    await enqueue("{not json");

    const handled = await consumerWith(new MikroOrmUnitOfWork(db.orm), 5).pollOnce(10, 2);

    expect(handled).toBe(1);
    const [dead] = await drainDeadLetters();
    expect(dead).toMatchObject({ code: "INVALID_JSON", originalBody: "{not json" });
    expect(await queue.receive(mainQueue, { maxMessages: 10, waitTimeSeconds: 1 })).toEqual([]);
  });

  test("retries exhausted: FAILED is persisted and the message ends in the DLQ", async () => {
    const created = await new CreateWalletUseCase(
      new MikroOrmUnitOfWork(db.orm),
      clock,
      ids,
    ).execute({
      playerId: `player-${suffix}`,
      initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
    });
    if (created.outcome !== "created") throw new Error("expected wallet");
    const externalTransactionId = crypto.randomUUID();
    await enqueue(
      JSON.stringify({
        messageId: `msg-${externalTransactionId}`,
        type: "WagerTransactionRequested",
        occurredAt: "2026-11-14T12:00:00.000Z",
        data: {
          providerId: "provider-a",
          externalTransactionId,
          idempotencyKey: `provider-a:${externalTransactionId}`,
          playerId: created.wallet.playerId,
          walletId: created.wallet.id,
          roundId: "round-1",
          gameId: "game-1",
          kind: "BET",
          money: { amount: "10.00", currency: "BRL" },
        },
      }),
    );

    await consumerWith(new UnavailableUnitOfWork(), 1).pollOnce(10, 2);

    const [dead] = await drainDeadLetters();
    expect(dead).toMatchObject({
      code: "RETRIES_EXHAUSTED",
      messageId: `msg-${externalTransactionId}`,
      receiveCount: 1,
    });
    const stored = await db.orm.em.fork().findOneOrFail(WagerTransactionSchema, {
      externalTransactionId,
    });
    expect(stored.status).toBe(TransactionStatus.FAILED);
    expect(stored.failureCode).toBe(FailureCode.INTERNAL_PERMANENT_ERROR);
  });
});
