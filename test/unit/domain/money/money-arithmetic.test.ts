import { describe, expect, test } from "bun:test";
import { CurrencyMismatchError } from "../../../../src/domain/money/currency-mismatch.error";
import { Money } from "../../../../src/domain/money/money";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

describe("Money arithmetic", () => {
  test("adds two amounts without float drift", () => {
    expect(brl("0.10").add(brl("0.20")).toJSON()).toEqual({ amount: "0.30", currency: "BRL" });
  });

  test("subtracts and may produce a negative amount", () => {
    expect(brl("10.00").subtract(brl("25.50")).toJSON().amount).toBe("-15.50");
  });

  test("negates an amount", () => {
    expect(brl("7.25").negate().toJSON().amount).toBe("-7.25");
  });

  test("returns new instances and keeps operands unchanged", () => {
    const a = brl("1.00");
    const sum = a.add(brl("2.00"));
    expect(sum).not.toBe(a);
    expect(a.toJSON().amount).toBe("1.00");
  });

  test("throws CurrencyMismatchError when currencies differ", () => {
    const usd = Money.from({ amount: "1.00", currency: "USD" });
    expect(() => brl("1.00").add(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl("1.00").subtract(usd)).toThrow(CurrencyMismatchError);
  });
});
