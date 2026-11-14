import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LedgerDirection } from "../../src/domain/wallet/wallet-ledger-entry";
import { WalletLedgerEntrySchema } from "../../src/infrastructure/persistence/models/wallet-ledger-entry.model";
import { type Cluster, startCluster } from "../support/cluster";
import { balanceOf, bet, createWallet } from "../support/cluster-scenario";
import { field } from "../support/http-app";
import { assertLedgerInvariant } from "../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

// README §8: saldo 100.00, duas apostas de 80.00 simultâneas.
const REPETITIONS = 20;
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

async function runScenario(): Promise<void> {
  const walletId = await createWallet(cluster.next(), "100.00");
  const bets = [crypto.randomUUID(), crypto.randomUUID()].map((externalTransactionId) => ({
    walletId,
    externalTransactionId,
    amount: "80.00",
  }));

  const replies = await Promise.all(bets.map((request) => bet(cluster.next(), request)));
  const retries = await Promise.all(bets.map((request) => bet(cluster.next(), request)));

  expect(replies.map((reply) => reply.status).sort()).toEqual([201, 422]);
  const rejected = replies.find((reply) => reply.status === 422);
  expect(field(rejected?.body, "code")).toBe("INSUFFICIENT_FUNDS");
  expect(retries.map((reply) => reply.status).sort()).toEqual([200, 422]);
  for (const reply of retries) expect(field(reply.body, "idempotentReplay")).toBe(true);
  expect(await balanceOf(cluster.next(), walletId)).toEqual({ amount: "20.00", currency: "BRL" });
  const debits = await db.orm.em
    .fork()
    .count(WalletLedgerEntrySchema, { walletId, direction: LedgerDirection.DEBIT });
  expect(debits).toBe(1);
  await assertLedgerInvariant(db.orm.em.fork(), walletId);
}

describe("mandatory scenario across 3 instances", () => {
  test(`two simultaneous 80.00 bets on 100.00, repeated ${REPETITIONS} times`, async () => {
    for (let round = 0; round < REPETITIONS; round += 1) await runScenario();
  }, 60_000);
});
