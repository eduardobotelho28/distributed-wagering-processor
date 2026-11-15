import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import { TransactionKind } from "../../src/domain/transaction/transaction-kind";
import { loadConfig } from "../../src/infrastructure/config/app-config";
import { createSqsClient } from "../../src/infrastructure/messaging/sqs-client";
import { OutboxMessageSchema } from "../../src/infrastructure/persistence/models/outbox-message.model";
import { WagerTransactionSchema } from "../../src/infrastructure/persistence/models/wager-transaction.model";
import { waitFor } from "../support/app-process";
import { type Cluster, startCluster } from "../support/cluster";
import { bet, createWallet } from "../support/cluster-scenario";
import { assertLedgerInvariant } from "../support/ledger-invariant";
import { createTestQueues, type SqsTestQueues } from "../support/sqs-fixture";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

const WALLETS = 8;
const PER_WALLET = 10;
const client = createSqsClient(loadConfig(process.env).sqs);
const eventsQueue = `test-restart-events-${crypto.randomUUID()}`;
let db: TestDatabase;
let queues: SqsTestQueues;
let env: Record<string, string>;

beforeAll(async () => {
  db = await createTestDatabase();
  queues = await createTestQueues(5);
  await client.send(new CreateQueueCommand({ QueueName: eventsQueue }));
  env = {
    DATABASE_URL: db.url,
    SQS_TRANSACTIONS_QUEUE: queues.main,
    SQS_TRANSACTIONS_DLQ: queues.deadLetter,
    SQS_EVENTS_QUEUE: eventsQueue,
    SQS_CONSUMER_ENABLED: "true",
    BACKGROUND_WORKERS_ENABLED: "true",
    OUTBOX_PUBLISH_INTERVAL_MS: "50",
  };
}, 60_000);

afterAll(async () => {
  await client.send(new DeleteQueueCommand({ QueueUrl: await queues.queue.urlOf(eventsQueue) }));
  await queues.dispose();
  await db.dispose();
}, 60_000);

function sqsBet(walletId: string, index: number): Promise<void> {
  const externalTransactionId = `sqs-${walletId}-${index}`;
  return queues.queue.send(queues.main, {
    groupId: walletId,
    deduplicationId: externalTransactionId,
    body: JSON.stringify({
      messageId: `msg-${externalTransactionId}`,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "provider-a",
        externalTransactionId,
        idempotencyKey: `provider-a:${externalTransactionId}`,
        playerId: "player-cluster",
        walletId,
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: "1.00", currency: "BRL" },
      },
    }),
  });
}

function sqsBetsRecorded(): Promise<number> {
  return db.orm.em.fork().count(WagerTransactionSchema, {
    kind: TransactionKind.BET,
    externalTransactionId: { $like: "sqs-%" },
  });
}

async function drained(): Promise<boolean> {
  const outbox = await db.orm.em.fork().count(OutboxMessageSchema, { publishedAt: null });
  return outbox === 0 && (await queues.depth(queues.main)) === 0;
}

describe("restart consistency", () => {
  test("all instances killed mid-load: after restart every wallet balances", async () => {
    const first: Cluster = await startCluster(3, env);
    const walletIds = await Promise.all(
      Array.from({ length: WALLETS }, () => createWallet(first.next(), "500.00")),
    );
    const httpLoad = walletIds.flatMap((walletId) =>
      Array.from({ length: PER_WALLET }, () =>
        bet(first.next(), {
          walletId,
          externalTransactionId: crypto.randomUUID(),
          amount: "1.00",
        }).catch(() => null),
      ),
    );
    for (const walletId of walletIds) {
      for (let index = 0; index < PER_WALLET; index += 1) await sqsBet(walletId, index);
    }

    await waitFor(async () => (await sqsBetsRecorded()) >= 10, 30_000);
    await first.kill();
    await Promise.all(httpLoad);
    const recordedAtCrash = await sqsBetsRecorded();

    const second = await startCluster(3, env);
    await waitFor(drained, 45_000);
    await second.stop();

    expect(recordedAtCrash).toBeLessThan(WALLETS * PER_WALLET);
    for (const walletId of walletIds) {
      const sqsBets = await db.orm.em.fork().count(WagerTransactionSchema, {
        walletId,
        externalTransactionId: { $like: "sqs-%" },
      });
      expect(sqsBets).toBe(PER_WALLET);
      await assertLedgerInvariant(db.orm.em.fork(), walletId);
    }
  }, 120_000);
});
