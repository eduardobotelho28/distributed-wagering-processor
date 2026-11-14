import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Cluster, startCluster } from "../support/cluster";
import { balanceOf, countBy, createWallet, wager } from "../support/cluster-scenario";
import { field } from "../support/http-app";
import { assertLedgerInvariant } from "../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

const ROUNDS = 10;
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

async function processedBet(walletId: string): Promise<string> {
  const betId = `bet-${crypto.randomUUID()}`;
  const reply = await wager(cluster.next(), {
    walletId,
    kind: "BET",
    externalTransactionId: betId,
    amount: "30.00",
  });
  if (reply.status !== 201) throw new Error("bet not processed");
  return betId;
}

async function raceReversals(kinds: [string, string]): Promise<void> {
  const walletId = await createWallet(cluster.next(), "100.00");
  const betId = await processedBet(walletId);

  const replies = await Promise.all(
    kinds.map((kind) =>
      wager(cluster.next(), {
        walletId,
        kind,
        externalTransactionId: `${kind.toLowerCase()}-${crypto.randomUUID()}`,
        amount: "30.00",
        referenceExternalTransactionId: betId,
      }),
    ),
  );

  expect(countBy(replies, (reply) => String(reply.status))).toEqual({ "201": 1, "422": 1 });
  const rejected = replies.find((reply) => reply.status === 422);
  expect(field(rejected?.body, "code")).toBe("REFERENCE_ALREADY_REVERSED");
  expect(await balanceOf(cluster.next(), walletId)).toEqual({ amount: "100.00", currency: "BRL" });
  await assertLedgerInvariant(db.orm.em.fork(), walletId);
}

describe("concurrent reversals of the same processed BET across instances", () => {
  test(`two ROLLBACKs in parallel: exactly one PROCESSED (x${ROUNDS})`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) await raceReversals(["ROLLBACK", "ROLLBACK"]);
  }, 60_000);

  test(`REFUND + ROLLBACK in parallel: exactly one PROCESSED (x${ROUNDS})`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) await raceReversals(["REFUND", "ROLLBACK"]);
  }, 60_000);
});
