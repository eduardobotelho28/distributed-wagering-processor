import { describe, expect, test } from "bun:test";
import { InvalidTransactionStateError } from "../../../../src/domain/errors/invalid-transaction-state.error";
import { InvariantViolationError } from "../../../../src/domain/errors/invariant-violation.error";
import { CurrencyMismatchError } from "../../../../src/domain/money/currency-mismatch.error";
import { InvalidMoneyError } from "../../../../src/domain/money/invalid-money.error";

describe("domain errors", () => {
  const cases = [
    { error: new InvalidMoneyError("bad"), code: "INVALID_MONEY", name: "InvalidMoneyError" },
    {
      error: new CurrencyMismatchError("BRL", "USD"),
      code: "CURRENCY_MISMATCH",
      name: "CurrencyMismatchError",
    },
    {
      error: new InvalidTransactionStateError("PROCESSED", "reject"),
      code: "INVALID_TRANSACTION_STATE",
      name: "InvalidTransactionStateError",
    },
    {
      error: new InvariantViolationError("balance >= 0"),
      code: "INVARIANT_VIOLATION",
      name: "InvariantViolationError",
    },
  ];

  for (const { error, code, name } of cases) {
    test(`${name} carries the stable code ${code}`, () => {
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe(code);
      expect(error.name).toBe(name);
    });
  }

  test("codes are unique across domain errors", () => {
    const codes = cases.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("InvalidTransactionStateError names the source state and the action", () => {
    expect(new InvalidTransactionStateError("REJECTED", "markProcessed").message).toBe(
      "Invalid transaction transition: cannot markProcessed from REJECTED",
    );
  });
});
