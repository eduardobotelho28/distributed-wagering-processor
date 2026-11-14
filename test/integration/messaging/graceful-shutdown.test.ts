import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import { AbandonWagerMessageUseCase } from "../../../src/application/abandon-wager-message/abandon-wager-message.use-case";
import { ConsumeWagerMessageUseCase } from "../../../src/application/consume-wager-message/consume-wager-message.use-case";
import { CreateWalletUseCase } from "../../../src/application/create-wallet/create-wallet.use-case";
import { Money } from "../../../src/domain/money/money";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import type { Wallet } from "../../../src/domain/wallet/wallet";
import { loadConfig } from "../../../src/infrastructure/config/app-config";
import { createSqsClient } from "../../../src/infrastructure/messaging/sqs-client";
import { SqsMessageQueue } from "../../../src/infrastructure/messaging/sqs-message-queue";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { WagerTransactionSchema } from "../../../src/infrastructure/persistence/models/wager-transaction.model";
import { WalletSchema } from "../../../src/infrastructure/persistence/models/wallet.model";
import { WalletLedgerEntrySchema } from "../../../src/infrastructure/persistence/models/wallet-ledger-entry.model";
import { SystemClock } from "../../../src/infrastructure/time/system-clock";
import { UuidV7IdGenerator } from "../../../src/infrastructure/time/uuid-v7-id-generator";
import { CONSUMER_NAME } from "../../../src/interfaces/sqs/sqs-consumer.module";
import { WagerMessageConsumer } from "../../../src/interfaces/sqs/wager-message.consumer";
import { startAppProcess, waitFor } from "../../support/app-process";
import { RecordingLogger, RecordingMetrics } from "../../support/fakes";
import { assertLedgerInvariant } from "../../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

const MESSAGES = 20;
const suffix = crypto.randomUUID();
const mainQueue = `test-shutdown-${suffix}.fifo`;
const deadLetterQueue = `test-shutdown-dlq-${suffix}.fifo`;
const client = createSqsClient(loadConfig(process.env).sqs);
const queue = new SqsMessageQueue(client);
const clock = new SystemClock();
const ids = new UuidV7IdGenerator();
let db: TestDatabase;

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

async function newWallet(): Promise<Wallet> {
  const created = await new CreateWalletUseCase(new MikroOrmUnitOfWork(db.orm), clock, ids).execute(
    {
      playerId: `player-${suffix}`,
      initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
    },
  );
  if (created.outcome !== "created") throw new Error("expected wallet");
  return created.wallet;
}

async function enqueueBets(wallet: Wallet): Promise<void> {
  for (let index = 0; index < MESSAGES; index += 1) {
    const externalTransactionId = `bet-${suffix}-${index}`;
    await queue.send(mainQueue, {
      groupId: wallet.id,
      deduplicationId: externalTransactionId,
      body: JSON.stringify({
        messageId: `msg-${externalTransactionId}`,
        type: "WagerTransactionRequested",
        occurredAt: "2026-11-14T12:00:00.000Z",
        data: {
          providerId: "provider-a",
          externalTransactionId,
          idempotencyKey: `provider-a:${externalTransactionId}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "round-1",
          gameId: "game-1",
          kind: "BET",
          money: { amount: "1.00", currency: "BRL" },
        },
      }),
    });
  }
}

function countBets(walletId: string): Promise<number> {
  return db.orm.em.fork().count(WagerTransactionSchema, { walletId, kind: TransactionKind.BET });
}

function startApp() {
  return startAppProcess({
    DATABASE_URL: db.url,
    SQS_TRANSACTIONS_QUEUE: mainQueue,
    SQS_TRANSACTIONS_DLQ: deadLetterQueue,
    SQS_CONSUMER_ENABLED: "true",
  });
}

async function drainWithFreshConsumer(): Promise<void> {
  const consumer = new WagerMessageConsumer(
    {
      queue,
      consume: new ConsumeWagerMessageUseCase(new MikroOrmUnitOfWork(db.orm), clock, ids),
      abandon: new AbandonWagerMessageUseCase(new MikroOrmUnitOfWork(db.orm), clock, ids),
      clock,
      logger: new RecordingLogger(),
      metrics: new RecordingMetrics(),
    },
    {
      queueName: mainQueue,
      deadLetterQueueName: deadLetterQueue,
      consumerName: CONSUMER_NAME,
      maxReceives: 5,
    },
  );
  let emptyPolls = 0;
  while (emptyPolls < 2) {
    emptyPolls = (await consumer.pollOnce(10, 1)) === 0 ? emptyPolls + 1 : 0;
  }
}

describe("graceful shutdown", () => {
  test("SIGTERM mid-processing loses and duplicates nothing", async () => {
    const wallet = await newWallet();
    await enqueueBets(wallet);
    const app = startApp();

    await waitFor(async () => (await countBets(wallet.id)) >= 1, 30_000);
    app.kill("SIGTERM");
    await app.exited;
    const processedBeforeExit = await countBets(wallet.id);
    await drainWithFreshConsumer();

    expect(processedBeforeExit).toBeGreaterThanOrEqual(1);
    expect(await countBets(wallet.id)).toBe(MESSAGES);
    expect(await db.orm.em.fork().count(WalletLedgerEntrySchema, { walletId: wallet.id })).toBe(
      MESSAGES + 1,
    );
    const stored = await db.orm.em.fork().findOneOrFail(WalletSchema, { id: wallet.id });
    expect(stored).toMatchObject({ balance: "980.00" });
    await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
  }, 60_000);
});
