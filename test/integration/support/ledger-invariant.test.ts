import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Money } from "../../../src/domain/money/money";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import { LedgerDirection, WalletLedgerEntry } from "../../../src/domain/wallet/wallet-ledger-entry";
import { WalletSchema } from "../../../src/infrastructure/persistence/models/wallet.model";
import { FIXED_NOW, recordMovement, seedWallet } from "../../support/factories";
import {
  assertLedgerInvariant,
  findLedgerViolations,
  LedgerInvariantError,
} from "../../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.dispose();
});

describe("assertLedgerInvariant against Postgres", () => {
  test("passes for a seeded wallet with bets and wins", async () => {
    const em = db.orm.em.fork();
    const wallet = await seedWallet(em, { balance: "100.00" });
    await recordMovement(em, wallet, { kind: TransactionKind.BET, amount: "30.10" });
    await recordMovement(em, wallet, { kind: TransactionKind.WIN, amount: "0.20" });

    await assertLedgerInvariant(em, wallet.id);
    expect(wallet.balance.toJSON().amount).toBe("70.10");
  });

  test("passes for a wallet seeded with zero and no entries", async () => {
    const em = db.orm.em.fork();
    const wallet = await seedWallet(em, { balance: "0.00" });

    await assertLedgerInvariant(em, wallet.id);
  });

  test("fails when the wallet balance drifts from the ledger sum", async () => {
    const em = db.orm.em.fork();
    const wallet = await seedWallet(em, { balance: "50.00" });
    await em.nativeUpdate(WalletSchema, { id: wallet.id }, { balance: "50.01" });

    await expect(assertLedgerInvariant(em, wallet.id)).rejects.toThrow(LedgerInvariantError);
  });
});

describe("findLedgerViolations", () => {
  function entry(
    id: string,
    direction: LedgerDirection,
    amount: string,
    before: string,
    after: string,
  ) {
    return WalletLedgerEntry.rehydrate({
      id,
      walletId: "w-1",
      transactionId: id,
      direction,
      amount: brl(amount),
      balanceBefore: brl(before),
      balanceAfter: brl(after),
      createdAt: FIXED_NOW,
    });
  }

  test("reports an entry that does not chain from the previous one", () => {
    const entries = [
      entry("e1", LedgerDirection.CREDIT, "10.00", "0.00", "10.00"),
      entry("e2", LedgerDirection.CREDIT, "5.00", "20.00", "25.00"),
    ];

    expect(findLedgerViolations(brl("15.00"), entries).join()).toContain("e2 does not chain");
  });

  test("reports an unbalanced entry", () => {
    const entries = [entry("e1", LedgerDirection.DEBIT, "1.00", "0.00", "1.00")];

    expect(findLedgerViolations(brl("1.00"), entries).join()).toContain("e1 is unbalanced");
  });

  test("returns no violations for a consistent chain", () => {
    const entries = [
      entry("e1", LedgerDirection.CREDIT, "10.00", "0.00", "10.00"),
      entry("e2", LedgerDirection.DEBIT, "2.50", "10.00", "7.50"),
    ];

    expect(findLedgerViolations(brl("7.50"), entries)).toEqual([]);
  });
});
