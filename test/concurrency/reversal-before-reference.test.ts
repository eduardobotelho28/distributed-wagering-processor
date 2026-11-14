import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import { FailureCode } from "../../src/domain/errors/failure-code";
import { TransactionKind } from "../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../src/domain/transaction/transaction-status";
import { loadConfig } from "../../src/infrastructure/config/app-config";
import { createSqsClient } from "../../src/infrastructure/messaging/sqs-client";
import { SqsMessageQueue } from "../../src/infrastructure/messaging/sqs-message-queue";
import { WagerTransactionSchema } from "../../src/infrastructure/persistence/models/wager-transaction.model";
import { waitFor } from "../support/app-process";
import { type Cluster, startCluster } from "../support/cluster";
import { balanceOf, createWallet, wager } from "../support/cluster-scenario";
import { assertLedgerInvariant } from "../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

const WALLETS = 5;
const eventsQueue = `test-reversal-events-${crypto.randomUUID()}`;
const client = createSqsClient(loadConfig(process.env).sqs);
let db: TestDatabase;
let cluster: Cluster;

beforeAll(async () => {
  db = await createTestDatabase();
  await client.send(new CreateQueueCommand({ QueueName: eventsQueue }));
  cluster = await startCluster(3, {
    DATABASE_URL: db.url,
    SQS_EVENTS_QUEUE: eventsQueue,
    BACKGROUND_WORKERS_ENABLED: "true",
    PENDING_REFERENCE_INTERVAL_MS: "200",
  });
}, 60_000);

afterAll(async () => {
  await cluster.stop();
  const queue = new SqsMessageQueue(client);
  await client.send(new DeleteQueueCommand({ QueueUrl: await queue.urlOf(eventsQueue) }));
  await db.dispose();
}, 60_000);

async function raceReversalsAgainstBet(walletId: string): Promise<string> {
  const betId = `bet-${crypto.randomUUID()}`;
  const reversal = (kind: string) =>
    wager(cluster.next(), {
      walletId,
      kind,
      externalTransactionId: `${kind.toLowerCase()}-${crypto.randomUUID()}`,
      amount: "40.00",
      referenceExternalTransactionId: betId,
    });
  // As reversões saem primeiro; a BET parte logo atrás, sem esperar por elas.
  await Promise.all([
    reversal("ROLLBACK"),
    reversal("REFUND"),
    wager(cluster.next(), { walletId, kind: "BET", externalTransactionId: betId, amount: "40.00" }),
  ]);
  return betId;
}

function transactionsOf(walletId: string) {
  return db.orm.em
    .fork()
    .find(WagerTransactionSchema, { walletId, kind: { $ne: TransactionKind.OPENING } });
}

describe("reversals delivered before their BET, in parallel with it", () => {
  test("final state is correct and only one reversal is applied", async () => {
    const walletIds = await Promise.all(
      Array.from({ length: WALLETS }, () => createWallet(cluster.next(), "100.00")),
    );

    await Promise.all(walletIds.map((walletId) => raceReversalsAgainstBet(walletId)));
    await waitFor(async () => {
      const pending = await db.orm.em
        .fork()
        .count(WagerTransactionSchema, { status: TransactionStatus.PENDING_REFERENCE });
      return pending === 0;
    }, 45_000);

    for (const walletId of walletIds) {
      const rows = await transactionsOf(walletId);
      const bet = rows.find((row) => row.kind === TransactionKind.BET);
      const reversals = rows.filter((row) => row.kind !== TransactionKind.BET);
      expect(bet?.status).toBe(TransactionStatus.PROCESSED);
      expect(reversals.map((row) => row.status).sort()).toEqual([
        TransactionStatus.PROCESSED,
        TransactionStatus.REJECTED,
      ]);
      const rejected = reversals.find((row) => row.status === TransactionStatus.REJECTED);
      expect(rejected?.failureCode).toBe(FailureCode.REFERENCE_ALREADY_REVERSED);
      expect(await balanceOf(cluster.next(), walletId)).toEqual({
        amount: "100.00",
        currency: "BRL",
      });
      await assertLedgerInvariant(db.orm.em.fork(), walletId);
    }
  }, 60_000);
});
