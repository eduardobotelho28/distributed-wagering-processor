import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { InvariantViolationError } from "../../../../src/domain/errors/invariant-violation.error";
import { CurrencyMismatchError } from "../../../../src/domain/money/currency-mismatch.error";
import { Money } from "../../../../src/domain/money/money";
import { InsufficientFundsError } from "../../../../src/domain/wallet/insufficient-funds.error";
import { Wallet } from "../../../../src/domain/wallet/wallet";
import { LedgerDirection } from "../../../../src/domain/wallet/wallet-ledger-entry";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
const usd = (amount: string): Money => Money.from({ amount, currency: "USD" });
const now = new Date("2026-01-01T00:00:00.000Z");
const walletWith = (amount: string): Wallet =>
  Wallet.open({ id: "w-1", playerId: "p-1", initialBalance: brl(amount) });

describe("Wallet debit and credit", () => {
  test("debit lowers the balance and returns a balanced ledger entry", () => {
    const wallet = walletWith("100.00");
    const entry = wallet.debit(brl("30.50"), "tx-1", now);
    expect(wallet.balance.toString()).toBe("69.50 BRL");
    expect(entry.direction).toBe(LedgerDirection.DEBIT);
    expect(entry.transactionId).toBe("tx-1");
    expect(entry.walletId).toBe("w-1");
    expect(entry.balanceBefore.toString()).toBe("100.00 BRL");
    expect(entry.balanceAfter.toString()).toBe("69.50 BRL");
    expect(entry.createdAt.toISOString()).toBe(now.toISOString());
  });

  test("credit raises the balance and returns a balanced ledger entry", () => {
    const wallet = walletWith("10.00");
    const entry = wallet.credit(brl("5.25"), "tx-2", now);
    expect(wallet.balance.toString()).toBe("15.25 BRL");
    expect(entry.direction).toBe(LedgerDirection.CREDIT);
    expect(entry.isBalanced()).toBe(true);
  });

  test("debit of the exact balance leaves it at zero", () => {
    const wallet = walletWith("20.00");
    wallet.debit(brl("20.00"), "tx-1", now);
    expect(wallet.balance.isZero()).toBe(true);
  });

  test("rejects the debit when balance is insufficient and keeps state", () => {
    const wallet = walletWith("20.00");
    expect(() => wallet.debit(brl("20.01"), "tx-1", now)).toThrow(InsufficientFundsError);
    expect(wallet.balance.toString()).toBe("20.00 BRL");
    expect(wallet.version).toBe(1);
  });

  test("insufficient funds error carries the INSUFFICIENT_FUNDS failure code", () => {
    expect(new InsufficientFundsError("w-1").code).toBe(FailureCode.INSUFFICIENT_FUNDS);
  });

  test("throws on currency mismatch for debit and credit without changing state", () => {
    const wallet = walletWith("20.00");
    expect(() => wallet.debit(usd("1.00"), "tx-1", now)).toThrow(CurrencyMismatchError);
    expect(() => wallet.credit(usd("1.00"), "tx-2", now)).toThrow(CurrencyMismatchError);
    expect(wallet.version).toBe(1);
  });

  test("increments version once per balance change", () => {
    const wallet = walletWith("20.00");
    wallet.debit(brl("1.00"), "tx-1", now);
    wallet.credit(brl("2.00"), "tx-2", now);
    expect(wallet.version).toBe(3);
  });

  test("rejects a zero amount without changing version", () => {
    const wallet = walletWith("20.00");
    expect(() => wallet.credit(brl("0"), "tx-1", now)).toThrow(InvariantViolationError);
    expect(() => wallet.debit(brl("0"), "tx-2", now)).toThrow(InvariantViolationError);
    expect(wallet.version).toBe(1);
    expect(wallet.balance.toString()).toBe("20.00 BRL");
  });
});
