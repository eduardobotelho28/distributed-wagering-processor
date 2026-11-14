import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import { SubmitWagerTransactionUseCase } from "../../../src/application/submit-wager-transaction/submit-wager-transaction.use-case";
import { Money } from "../../../src/domain/money/money";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import { loadConfig } from "../../../src/infrastructure/config/app-config";
import { createSqsClient } from "../../../src/infrastructure/messaging/sqs-client";
import { SqsMessageQueue } from "../../../src/infrastructure/messaging/sqs-message-queue";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { OutboxMessageSchema } from "../../../src/infrastructure/persistence/models/outbox-message.model";
import { SystemClock } from "../../../src/infrastructure/time/system-clock";
import { UuidV7IdGenerator } from "../../../src/infrastructure/time/uuid-v7-id-generator";
import { startAppProcess, waitFor } from "../../support/app-process";
import { walletIn } from "../../support/sqs-fixture";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

const BETS = 20;
const eventsQueue = `test-events-${crypto.randomUUID()}`;
const client = createSqsClient(loadConfig(process.env).sqs);
const queue = new SqsMessageQueue(client);
let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await client.send(new CreateQueueCommand({ QueueName: eventsQueue }));
});

afterAll(async () => {
  await client.send(new DeleteQueueCommand({ QueueUrl: await queue.urlOf(eventsQueue) }));
  await db.dispose();
});

async function fillOutbox(): Promise<void> {
  const wallet = await walletIn(db, "1000.00");
  const submit = new SubmitWagerTransactionUseCase(
    new MikroOrmUnitOfWork(db.orm),
    new SystemClock(),
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
      context: { correlationId: "corr-two", causationId: null },
    });
  }
}

async function publishedEventIds(): Promise<string[]> {
  const ids: string[] = [];
  let empty = 0;
  while (empty < 2) {
    const messages = await queue.receive(eventsQueue, { maxMessages: 10, waitTimeSeconds: 1 });
    empty = messages.length === 0 ? empty + 1 : 0;
    for (const message of messages) {
      ids.push(String(JSON.parse(message.body).eventId));
      await queue.ack(eventsQueue, message.receiptHandle);
    }
  }
  return ids;
}

function pendingOutbox(): Promise<number> {
  return db.orm.em.fork().count(OutboxMessageSchema, { publishedAt: null });
}

describe("scheduler with two instances", () => {
  test("two app instances publishing the same outbox never double-process", async () => {
    await fillOutbox();
    const total = await db.orm.em.fork().count(OutboxMessageSchema, {});
    const env = {
      DATABASE_URL: db.url,
      SQS_EVENTS_QUEUE: eventsQueue,
      BACKGROUND_WORKERS_ENABLED: "true",
      OUTBOX_PUBLISH_INTERVAL_MS: "10",
      OUTBOX_BATCH_SIZE: "3",
    };
    const instances = [startAppProcess(env), startAppProcess(env)];

    await waitFor(async () => (await pendingOutbox()) === 0, 30_000);
    for (const instance of instances) instance.kill("SIGTERM");
    await Promise.all(instances.map((instance) => instance.exited));
    const ids = await publishedEventIds();

    expect(total).toBe(BETS * 2);
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
  }, 60_000);
});
