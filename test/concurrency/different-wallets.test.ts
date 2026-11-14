import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LockMode } from "@mikro-orm/postgresql";
import { WalletSchema } from "../../src/infrastructure/persistence/models/wallet.model";
import { type Cluster, startCluster } from "../support/cluster";
import { balanceOf, bet, createWallet } from "../support/cluster-scenario";
import { assertLedgerInvariant } from "../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

const WALLETS = 20;
const BETS_PER_WALLET = 5;
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

describe("different wallets in parallel across 3 instances", () => {
  test(`${WALLETS} wallets x ${BETS_PER_WALLET} bets all at once keep every invariant`, async () => {
    const walletIds = await Promise.all(
      Array.from({ length: WALLETS }, () => createWallet(cluster.next(), "50.00")),
    );

    const replies = await Promise.all(
      walletIds.flatMap((walletId) =>
        Array.from({ length: BETS_PER_WALLET }, () =>
          bet(cluster.next(), {
            walletId,
            externalTransactionId: crypto.randomUUID(),
            amount: "7.00",
          }),
        ),
      ),
    );

    expect(replies.every((reply) => reply.status === 201)).toBe(true);
    for (const walletId of walletIds) {
      expect(await balanceOf(cluster.next(), walletId)).toEqual({
        amount: "15.00",
        currency: "BRL",
      });
      await assertLedgerInvariant(db.orm.em.fork(), walletId);
    }
  }, 60_000);

  test("a locked wallet does not block bets on another wallet", async () => {
    const [lockedId, freeId] = [
      await createWallet(cluster.next(), "50.00"),
      await createWallet(cluster.next(), "50.00"),
    ];
    let release = (): void => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalLocked = (): void => {};
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const holder = db.orm.em.fork().transactional(async (em) => {
      await em.findOneOrFail(
        WalletSchema,
        { id: lockedId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      signalLocked();
      await hold;
    });
    await locked;

    let blockedDone = false;
    const blocked = bet(cluster.next(), {
      walletId: lockedId,
      externalTransactionId: crypto.randomUUID(),
      amount: "1.00",
    }).then((reply) => {
      blockedDone = true;
      return reply;
    });
    const free = await bet(cluster.next(), {
      walletId: freeId,
      externalTransactionId: crypto.randomUUID(),
      amount: "1.00",
    });

    // Dá tempo de sobra para a aposta em A chegar ao servidor: se não terminou, é o lock.
    await Bun.sleep(300);
    expect(free.status).toBe(201);
    expect(blockedDone).toBe(false);
    release();
    await holder;
    expect((await blocked).status).toBe(201);
    await assertLedgerInvariant(db.orm.em.fork(), lockedId);
    await assertLedgerInvariant(db.orm.em.fork(), freeId);
  }, 30_000);
});
