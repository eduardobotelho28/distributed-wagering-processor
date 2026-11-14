import { describe, expect, test } from "bun:test";
import { InvariantViolationError } from "../../../../src/domain/errors/invariant-violation.error";
import { CurrencyMismatchError } from "../../../../src/domain/money/currency-mismatch.error";
import { Money } from "../../../../src/domain/money/money";
import {
  LedgerDirection,
  WalletLedgerEntry,
  type WalletLedgerEntryProps,
} from "../../../../src/domain/wallet/wallet-ledger-entry";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

function props(overrides: Partial<WalletLedgerEntryProps> = {}): WalletLedgerEntryProps {
  return {
    id: "entry-1",
    walletId: "wallet-1",
    transactionId: "tx-1",
    direction: LedgerDirection.DEBIT,
    amount: brl("10.00"),
    balanceBefore: brl("100.00"),
    balanceAfter: brl("90.00"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("WalletLedgerEntry", () => {
  test("creates a balanced DEBIT entry", () => {
    const entry = WalletLedgerEntry.create(props());
    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.DEBIT);
    expect(entry.balanceAfter.toString()).toBe("90.00 BRL");
  });

  test("creates a balanced CREDIT entry", () => {
    const entry = WalletLedgerEntry.create(
      props({ direction: LedgerDirection.CREDIT, balanceAfter: brl("110.00") }),
    );
    expect(entry.isBalanced()).toBe(true);
  });

  test("allows a DEBIT that brings the balance to exactly zero", () => {
    const entry = WalletLedgerEntry.create(
      props({ amount: brl("100.00"), balanceAfter: brl("0") }),
    );
    expect(entry.balanceAfter.isZero()).toBe(true);
  });

  test("rejects an unbalanced DEBIT", () => {
    expect(() => WalletLedgerEntry.create(props({ balanceAfter: brl("91.00") }))).toThrow(
      InvariantViolationError,
    );
  });

  test("rejects a DEBIT whose balances match a CREDIT", () => {
    expect(() => WalletLedgerEntry.create(props({ balanceAfter: brl("110.00") }))).toThrow(
      InvariantViolationError,
    );
  });

  test("rejects an unbalanced CREDIT", () => {
    expect(() =>
      WalletLedgerEntry.create(
        props({ direction: LedgerDirection.CREDIT, balanceAfter: brl("90.00") }),
      ),
    ).toThrow(InvariantViolationError);
  });

  test("rejects a zero amount", () => {
    expect(() =>
      WalletLedgerEntry.create(props({ amount: brl("0"), balanceAfter: brl("100.00") })),
    ).toThrow(InvariantViolationError);
  });

  test("rejects mixed currencies", () => {
    expect(() =>
      WalletLedgerEntry.create(props({ amount: Money.from({ amount: "10.00", currency: "USD" }) })),
    ).toThrow(CurrencyMismatchError);
  });

  test("rehydrate does not revalidate", () => {
    const entry = WalletLedgerEntry.rehydrate(props({ balanceAfter: brl("1.00") }));
    expect(entry.isBalanced()).toBe(false);
  });

  test("is immutable", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const entry = WalletLedgerEntry.create(props({ createdAt }));
    createdAt.setFullYear(2000);
    entry.createdAt.setFullYear(2000);
    expect(entry.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(Object.isFrozen(entry)).toBe(true);
  });
});
