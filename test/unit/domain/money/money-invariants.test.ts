import { describe, expect, test } from "bun:test";
import { CurrencyMismatchError } from "../../../../src/domain/money/currency-mismatch.error";
import { InvalidMoneyError } from "../../../../src/domain/money/invalid-money.error";
import { Money } from "../../../../src/domain/money/money";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

describe("Money invariants", () => {
  test.each(["1.005", "0.999", "10.001", "2.675"])(
    "rejects %p instead of silently rounding",
    (amount) => {
      expect(() => brl(amount)).toThrow(InvalidMoneyError);
    },
  );

  test("0.10 + 0.20 equals 0.30 exactly", () => {
    expect(brl("0.10").add(brl("0.20")).equals(brl("0.30"))).toBe(true);
  });

  test("adds large values without losing cents", () => {
    const sum = brl("99999999999999999.99").add(brl("0.01"));
    expect(sum.toJSON().amount).toBe("100000000000000000.00");
  });

  test("subtracts large values without losing cents", () => {
    const diff = brl("100000000000000000.00").subtract(brl("0.01"));
    expect(diff.toJSON().amount).toBe("99999999999999999.99");
  });

  test("formats large values without scientific notation", () => {
    expect(brl("12345678901234567.89").toString()).toBe("12345678901234567.89 BRL");
  });

  test("keeps operands unchanged after every operation", () => {
    const a = brl("5.00");
    const b = brl("3.00");
    a.add(b);
    a.subtract(b);
    a.negate();
    expect(a.toJSON().amount).toBe("5.00");
    expect(b.toJSON().amount).toBe("3.00");
  });

  test("results of operations are frozen", () => {
    expect(Object.isFrozen(brl("1.00").add(brl("1.00")))).toBe(true);
    expect(Object.isFrozen(brl("1.00").negate())).toBe(true);
  });

  test("throws on currency conflict even with zero amounts", () => {
    expect(() => Money.zero("BRL").add(Money.zero("USD"))).toThrow(CurrencyMismatchError);
  });

  test("zero rejects invalid currency", () => {
    expect(() => Money.zero("brl")).toThrow(InvalidMoneyError);
  });
});
