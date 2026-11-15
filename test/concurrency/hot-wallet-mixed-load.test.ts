import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FailureCode } from "../../src/domain/errors/failure-code";
import { Money } from "../../src/domain/money/money";
import { TransactionKind } from "../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../src/domain/transaction/transaction-status";
import { WagerTransactionSchema } from "../../src/infrastructure/persistence/models/wager-transaction.model";
import { WalletSchema } from "../../src/infrastructure/persistence/models/wallet.model";
import { waitFor } from "../support/app-process";
import { type Cluster, startCluster } from "../support/cluster";
import { bet, createWallet, ownerOf } from "../support/cluster-scenario";
import { assertLedgerInvariant } from "../support/ledger-invariant";
import { createTestQueues, type SqsTestQueues } from "../support/sqs-fixture";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

const PER_CHANNEL = 25;
const BET_AMOUNT = "3.00";
let db: TestDatabase;
let queues: SqsTestQueues;
let cluster: Cluster;

beforeAll(async () => {
  db = await createTestDatabase();
  queues = await createTestQueues(30);
  cluster = await startCluster(3, {
    DATABASE_URL: db.url,
    SQS_TRANSACTIONS_QUEUE: queues.main,
    SQS_TRANSACTIONS_DLQ: queues.deadLetter,
    SQS_CONSUMER_ENABLED: "true",
  });
}, 60_000);

afterAll(async () => {
  await cluster.stop();
  await queues.dispose();
  await db.dispose();
}, 60_000);

function sqsBet(walletId: string): Promise<void> {
  const externalTransactionId = `sqs-${crypto.randomUUID()}`;
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
        playerId: ownerOf(walletId),
        walletId,
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: BET_AMOUNT, currency: "BRL" },
      },
    }),
  });
}

function bets(walletId: string) {
  return db.orm.em.fork().find(WagerTransactionSchema, { walletId, kind: TransactionKind.BET });
}

describe("3 instances, mixed HTTP and SQS load on the same hot wallet", () => {
  test("invariant holds and the balance never goes negative", async () => {
    const walletId = await createWallet(cluster.next(), "100.00");

    await Promise.all([
      ...Array.from({ length: PER_CHANNEL }, () => sqsBet(walletId)),
      ...Array.from({ length: PER_CHANNEL }, () =>
        bet(cluster.next(), {
          walletId,
          externalTransactionId: `http-${crypto.randomUUID()}`,
          amount: BET_AMOUNT,
        }),
      ),
    ]);
    await waitFor(async () => (await bets(walletId)).length === PER_CHANNEL * 2, 45_000);

    const recorded = await bets(walletId);
    const processed = recorded.filter((row) => row.status === TransactionStatus.PROCESSED);
    const rejected = recorded.filter((row) => row.status === TransactionStatus.REJECTED);
    expect(processed.length + rejected.length).toBe(PER_CHANNEL * 2);
    expect(rejected.every((row) => row.failureCode === FailureCode.INSUFFICIENT_FUNDS)).toBe(true);
    const wallet = await db.orm.em.fork().findOneOrFail(WalletSchema, { id: walletId });
    const balance = Money.from({ amount: wallet.balance, currency: "BRL" });
    expect(balance.isNegative()).toBe(false);
    const spent = processed.reduce(
      (sum) => sum.add(Money.from({ amount: BET_AMOUNT, currency: "BRL" })),
      Money.zero("BRL"),
    );
    expect(Money.from({ amount: "100.00", currency: "BRL" }).subtract(spent).equals(balance)).toBe(
      true,
    );
    expect(processed.length).toBe(33);
    expect(recorded.some((row) => row.externalTransactionId.startsWith("sqs-"))).toBe(true);
    await assertLedgerInvariant(db.orm.em.fork(), walletId);
  }, 60_000);
});
