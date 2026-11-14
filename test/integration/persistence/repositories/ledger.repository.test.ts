import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import type { Wallet } from "../../../../src/domain/wallet/wallet";
import { LedgerRepository } from "../../../../src/infrastructure/persistence/repositories/ledger.repository";
import { FIXED_NOW, recordMovement, seedWallet } from "../../../support/factories";
import { assertLedgerInvariant } from "../../../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../../../support/test-database";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.dispose();
});

async function collectAllPages(wallet: Wallet, limit: number): Promise<string[][]> {
  const repository = new LedgerRepository(db.orm.em.fork());
  const pages: string[][] = [];
  let cursor: string | null = null;
  do {
    const page = await repository.listByWallet({
      walletId: wallet.id,
      currency: wallet.currency,
      cursor,
      limit,
    });
    pages.push(page.entries.map((entry) => entry.id));
    cursor = page.nextCursor;
  } while (cursor !== null);
  return pages;
}

async function seedWithMovements(em: EntityManager, movements: number, at?: Date): Promise<Wallet> {
  const wallet = await seedWallet(em, { balance: "1000.00" });
  for (let index = 0; index < movements; index += 1) {
    const kind = index % 2 === 0 ? TransactionKind.BET : TransactionKind.WIN;
    await recordMovement(em, wallet, { kind, amount: "1.25", at });
  }
  return wallet;
}

describe("LedgerRepository pagination", () => {
  test("pages through 120 entries without duplicates or gaps", async () => {
    const em = db.orm.em.fork();
    const wallet = await seedWithMovements(em, 119);
    const all = await new LedgerRepository(em.fork()).listByWallet({
      walletId: wallet.id,
      currency: wallet.currency,
      cursor: null,
      limit: 500,
    });

    const pages = await collectAllPages(wallet, 50);

    expect(pages.map((page) => page.length)).toEqual([50, 50, 20]);
    expect(pages.flat()).toEqual(all.entries.map((entry) => entry.id));
    expect(new Set(pages.flat()).size).toBe(120);
    await assertLedgerInvariant(em, wallet.id);
    // DECISION: timeout próprio; semear 120 lançamentos são ~360 inserts sequenciais e o
    // padrão de 5s estoura quando o container está sob carga.
  }, 20_000);

  test("breaks ties on the same instant by id", async () => {
    const em = db.orm.em.fork();
    const wallet = await seedWithMovements(em, 6, FIXED_NOW);

    const pages = await collectAllPages(wallet, 2);

    expect(pages.flat()).toHaveLength(7);
    expect(new Set(pages.flat()).size).toBe(7);
  });

  test("returns an empty page without cursor for a wallet without entries", async () => {
    const wallet = await seedWallet(db.orm.em.fork(), { balance: "0.00" });

    expect(await collectAllPages(wallet, 10)).toEqual([[]]);
  });
});

describe("LedgerRepository sum", () => {
  test("sums credits minus debits to the wallet balance", async () => {
    const em = db.orm.em.fork();
    const wallet = await seedWallet(em, { balance: "10.00" });
    await recordMovement(em, wallet, { kind: TransactionKind.BET, amount: "0.10" });
    await recordMovement(em, wallet, { kind: TransactionKind.WIN, amount: "0.20" });

    const total = await new LedgerRepository(em.fork()).sumByWallet(wallet.id, "BRL");

    expect(total.toJSON()).toEqual({ amount: "10.10", currency: "BRL" });
    await assertLedgerInvariant(em, wallet.id);
  });

  test("returns zero for a wallet without entries", async () => {
    const total = await new LedgerRepository(db.orm.em.fork()).sumByWallet(
      crypto.randomUUID(),
      "BRL",
    );

    expect(total.toJSON()).toEqual({ amount: "0.00", currency: "BRL" });
  });
});
