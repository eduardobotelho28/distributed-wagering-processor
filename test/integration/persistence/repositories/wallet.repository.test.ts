import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Money } from "../../../../src/domain/money/money";
import { Wallet } from "../../../../src/domain/wallet/wallet";
import { WalletRepository } from "../../../../src/infrastructure/persistence/repositories/wallet.repository";
import { FIXED_NOW } from "../../../support/factories";
import { createTestDatabase, type TestDatabase } from "../../../support/test-database";

const LOCK_WAIT_MS = 300;
let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.dispose();
});

function openWallet(amount: string, playerId = `player-${crypto.randomUUID()}`): Wallet {
  return Wallet.open({
    id: crypto.randomUUID(),
    playerId,
    initialBalance: Money.from({ amount, currency: "BRL" }),
  });
}

async function persist(wallet: Wallet): Promise<void> {
  await new WalletRepository(db.orm.em.fork()).insert(wallet, FIXED_NOW);
}

describe("WalletRepository", () => {
  test("inserts and finds a wallet by id and by player and currency", async () => {
    const wallet = openWallet("12.34");
    await persist(wallet);
    const repository = new WalletRepository(db.orm.em.fork());

    const byId = await repository.findById(wallet.id);
    const byPlayer = await repository.findByPlayerAndCurrency(wallet.playerId, "BRL");

    expect(byId?.balance.toJSON()).toEqual({ amount: "12.34", currency: "BRL" });
    expect(byPlayer?.id).toBe(wallet.id);
    expect(await repository.findByPlayerAndCurrency(wallet.playerId, "USD")).toBeNull();
    expect(await repository.findById(crypto.randomUUID())).toBeNull();
  });

  test("saves balance and version of a locked wallet", async () => {
    const wallet = openWallet("10.00");
    await persist(wallet);

    await db.orm.em.fork().transactional(async (em) => {
      const repository = new WalletRepository(em);
      const locked = await repository.findByIdForUpdate(wallet.id);
      if (locked === null) throw new Error("wallet not found");
      locked.debit(Money.from({ amount: "0.10", currency: "BRL" }), crypto.randomUUID(), FIXED_NOW);
      await repository.saveBalance(locked, FIXED_NOW);
    });

    const saved = await new WalletRepository(db.orm.em.fork()).findById(wallet.id);
    expect(saved?.balance.toJSON().amount).toBe("9.90");
    expect(saved?.version).toBe(2);
  });

  test("blocks a second transaction on the wallet lock until the first commits", async () => {
    const wallet = openWallet("100.00");
    await persist(wallet);
    const events: string[] = [];
    let releaseFirst = (): void => {};
    const firstHolds = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstLocked = (): void => {};
    const lockTaken = new Promise<void>((resolve) => {
      firstLocked = resolve;
    });

    const first = db.orm.em.fork().transactional(async (em) => {
      const repository = new WalletRepository(em);
      const locked = await repository.findByIdForUpdate(wallet.id);
      if (locked === null) throw new Error("wallet not found");
      firstLocked();
      await firstHolds;
      locked.debit(
        Money.from({ amount: "40.00", currency: "BRL" }),
        crypto.randomUUID(),
        FIXED_NOW,
      );
      await repository.saveBalance(locked, FIXED_NOW);
      events.push("first saved");
    });

    await lockTaken;
    const second = db.orm.em.fork().transactional(async (em) => {
      const locked = await new WalletRepository(em).findByIdForUpdate(wallet.id);
      events.push(`second read ${locked?.balance.toJSON().amount ?? "none"}`);
    });

    await Bun.sleep(LOCK_WAIT_MS);
    expect(events).toEqual([]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first saved", "second read 60.00"]);
  });

  test("refuses to take the lock outside a transaction", async () => {
    const repository = new WalletRepository(db.orm.em.fork());

    await expect(repository.findByIdForUpdate(crypto.randomUUID())).rejects.toThrow();
  });
});
