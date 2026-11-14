import { describe, expect, test } from "bun:test";
import { CurrencyMismatchError } from "../../../../src/domain/money/currency-mismatch.error";
import { Money } from "../../../../src/domain/money/money";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
const usd = (amount: string): Money => Money.from({ amount, currency: "USD" });

describe("Money comparisons", () => {
  test("detects zero regardless of scale", () => {
    expect(brl("0").isZero()).toBe(true);
    expect(brl("0.00").isZero()).toBe(true);
    expect(brl("0.01").isZero()).toBe(false);
  });

  test("classifies sign of positive, negative and zero amounts", () => {
    expect(brl("0.01").isPositive()).toBe(true);
    expect(brl("0.01").isNegative()).toBe(false);
    expect(brl("0.01").negate().isNegative()).toBe(true);
    expect(brl("0.00").isPositive()).toBe(false);
    expect(brl("0.00").isNegative()).toBe(false);
  });

  test("compares amounts of the same currency", () => {
    expect(brl("9.99").isLessThan(brl("10.00"))).toBe(true);
    expect(brl("10.00").isLessThan(brl("10.00"))).toBe(false);
    expect(brl("10.01").isLessThan(brl("10.00"))).toBe(false);
  });

  test("treats amounts with different scale as equal", () => {
    expect(brl("10").equals(brl("10.00"))).toBe(true);
    expect(brl("10.00").equals(brl("10.01"))).toBe(false);
  });

  test("throws when comparing different currencies", () => {
    expect(() => brl("1.00").isLessThan(usd("1.00"))).toThrow(CurrencyMismatchError);
    expect(() => brl("1.00").equals(usd("1.00"))).toThrow(CurrencyMismatchError);
  });

  test("formats as amount with two decimals and currency", () => {
    expect(brl("5").toString()).toBe("5.00 BRL");
    expect(brl("5.5").negate().toString()).toBe("-5.50 BRL");
  });
});
