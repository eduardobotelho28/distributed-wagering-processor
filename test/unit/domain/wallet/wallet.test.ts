import { describe, expect, test } from "bun:test";
import { InvariantViolationError } from "../../../../src/domain/errors/invariant-violation.error";
import { Money } from "../../../../src/domain/money/money";
import { Wallet } from "../../../../src/domain/wallet/wallet";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

describe("Wallet", () => {
  test("opens with version 1 and currency taken from the initial balance", () => {
    const wallet = Wallet.open({ id: "w-1", playerId: "p-1", initialBalance: brl("50.00") });
    expect(wallet.id).toBe("w-1");
    expect(wallet.playerId).toBe("p-1");
    expect(wallet.version).toBe(1);
    expect(wallet.currency).toBe("BRL");
    expect(wallet.balance.toString()).toBe("50.00 BRL");
  });

  test("opens with a zero balance", () => {
    const wallet = Wallet.open({ id: "w-1", playerId: "p-1", initialBalance: brl("0") });
    expect(wallet.balance.isZero()).toBe(true);
  });

  test("rejects a negative initial balance", () => {
    const negative = brl("0").subtract(brl("1.00"));
    expect(() => Wallet.open({ id: "w-1", playerId: "p-1", initialBalance: negative })).toThrow(
      InvariantViolationError,
    );
  });

  test("rehydrates the stored state as is", () => {
    const wallet = Wallet.rehydrate({
      id: "w-1",
      playerId: "p-1",
      balance: brl("7.10"),
      version: 42,
    });
    expect(wallet.version).toBe(42);
    expect(wallet.balance.toString()).toBe("7.10 BRL");
  });

  test("rehydrate does not revalidate the balance", () => {
    const negative = brl("0").subtract(brl("1.00"));
    const wallet = Wallet.rehydrate({ id: "w-1", playerId: "p-1", balance: negative, version: 3 });
    expect(wallet.balance.isNegative()).toBe(true);
  });
});
