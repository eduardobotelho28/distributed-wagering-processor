import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TransactionKind } from "../../src/domain/transaction/transaction-kind";
import { LedgerDirection } from "../../src/domain/wallet/wallet-ledger-entry";
import { WagerTransactionSchema } from "../../src/infrastructure/persistence/models/wager-transaction.model";
import { WalletLedgerEntrySchema } from "../../src/infrastructure/persistence/models/wallet-ledger-entry.model";
import { type Cluster, startCluster } from "../support/cluster";
import { balanceOf, bet, countBy, createWallet } from "../support/cluster-scenario";
import { field } from "../support/http-app";
import { assertLedgerInvariant } from "../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

const PARALLEL = 50;
let db: TestDatabase;
let cluster: Cluster;

beforeAll(async () => {
  db = await createTestDatabase();
  cluster = await startCluster(3, { DATABASE_URL: db.url });
}, 60_000);

afterAll(async () => {
  await cluster.stop();
  await db.dispose();
}, 60_000);

describe("same bet sent 50 times in parallel across 3 instances", () => {
  test("exactly one debit, 49 replays, invariant holds", async () => {
    const walletId = await createWallet(cluster.next(), "100.00");
    const request = { walletId, externalTransactionId: crypto.randomUUID(), amount: "10.00" };

    const replies = await Promise.all(
      Array.from({ length: PARALLEL }, () => bet(cluster.next(), request)),
    );

    expect(countBy(replies, (reply) => String(reply.status))).toEqual({ "201": 1, "200": 49 });
    expect(countBy(replies, (reply) => String(field(reply.body, "idempotentReplay")))).toEqual({
      false: 1,
      true: 49,
    });
    const transactionIds = new Set(replies.map((reply) => field(reply.body, "transactionId")));
    expect(transactionIds.size).toBe(1);
    for (const reply of replies) {
      expect(field(reply.body, "balance")).toEqual({ amount: "90.00", currency: "BRL" });
    }
    const em = db.orm.em.fork();
    expect(await em.count(WagerTransactionSchema, { walletId, kind: TransactionKind.BET })).toBe(1);
    expect(
      await em.count(WalletLedgerEntrySchema, { walletId, direction: LedgerDirection.DEBIT }),
    ).toBe(1);
    expect(await balanceOf(cluster.next(), walletId)).toEqual({ amount: "90.00", currency: "BRL" });
    await assertLedgerInvariant(em, walletId);
  }, 30_000);
});
