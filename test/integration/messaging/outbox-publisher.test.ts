import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import { PublishOutboxBatchUseCase } from "../../../src/application/publish-outbox/publish-outbox-batch.use-case";
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
import { walletIn } from "../../support/sqs-fixture";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

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

async function receiveAll(): Promise<Record<string, unknown>[]> {
  const bodies: Record<string, unknown>[] = [];
  for (;;) {
    const messages = await queue.receive(eventsQueue, { maxMessages: 10, waitTimeSeconds: 1 });
    if (messages.length === 0) return bodies;
    for (const message of messages) {
      bodies.push(JSON.parse(message.body));
      await queue.ack(eventsQueue, message.receiptHandle);
    }
  }
}

describe("outbox publisher against Postgres and LocalStack", () => {
  test("publishes committed events to wager-events and marks them published", async () => {
    const unitOfWork = new MikroOrmUnitOfWork(db.orm);
    const clock = new SystemClock();
    const wallet = await walletIn(db, "100.00");
    const externalTransactionId = crypto.randomUUID();
    await new SubmitWagerTransactionUseCase(unitOfWork, clock, new UuidV7IdGenerator()).execute({
      idempotencyKey: `provider-a:${externalTransactionId}`,
      providerId: "provider-a",
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: TransactionKind.BET,
      money: Money.from({ amount: "10.00", currency: "BRL" }),
      referenceExternalTransactionId: null,
      context: { correlationId: "corr-publish", causationId: null },
    });
    const publisher = new PublishOutboxBatchUseCase(unitOfWork, queue, clock, {
      eventsQueue,
      batchSize: 50,
    });

    const result = await publisher.execute();
    const received = await receiveAll();

    expect(result).toEqual({ published: 2, failed: 0 });
    expect(received.map((event) => event.eventType).sort()).toEqual([
      "WagerTransactionProcessed",
      "WalletBalanceChanged",
    ]);
    expect(received[0]).toMatchObject({ correlationId: "corr-publish", eventVersion: 1 });
    const pending = await db.orm.em.fork().count(OutboxMessageSchema, { publishedAt: null });
    expect(pending).toBe(0);
    expect(await publisher.execute()).toEqual({ published: 0, failed: 0 });
  });
});
