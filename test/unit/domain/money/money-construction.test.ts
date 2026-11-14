import { describe, expect, test } from "bun:test";
import { InvalidMoneyError } from "../../../../src/domain/money/invalid-money.error";
import { Money } from "../../../../src/domain/money/money";

describe("Money construction", () => {
  test.each([
    ["25", "25.00"],
    ["25.5", "25.50"],
    ["25.05", "25.05"],
    ["0", "0.00"],
    ["00012.30", "12.30"],
    ["99999999999999999.99", "99999999999999999.99"],
  ])("normalizes %p to scale 2", (amount, expected) => {
    expect(Money.from({ amount, currency: "BRL" }).toJSON()).toEqual({
      amount: expected,
      currency: "BRL",
    });
  });

  test.each([
    "",
    "abc",
    "NaN",
    "Infinity",
    "1e3",
    "1E3",
    "-1",
    "-0.01",
    "1.234",
    ".5",
    "5.",
    " 1",
    "1,00",
    "+1",
  ])("rejects amount %p", (amount) => {
    expect(() => Money.from({ amount, currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  test.each([25, 25.5, null, undefined, {}])("rejects non-string amount %p", (amount) => {
    expect(() => Money.from({ amount, currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  test.each(["", "brl", "BR", "BRLL", 986])("rejects currency %p", (currency) => {
    expect(() => Money.from({ amount: "1.00", currency })).toThrow(InvalidMoneyError);
  });

  test("zero creates 0.00 in the given currency", () => {
    expect(Money.zero("USD").toJSON()).toEqual({ amount: "0.00", currency: "USD" });
  });

  test("is immutable", () => {
    const money = Money.from({ amount: "1.00", currency: "BRL" });
    expect(Object.isFrozen(money)).toBe(true);
  });

  test("serializes through JSON.stringify as a decimal string", () => {
    const money = Money.from({ amount: "25", currency: "BRL" });
    expect(JSON.stringify(money)).toBe('{"amount":"25.00","currency":"BRL"}');
  });
});
