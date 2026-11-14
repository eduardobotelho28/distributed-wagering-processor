import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";

describe("FailureCode", () => {
  test("each code value equals its key so stored and exposed codes stay stable", () => {
    for (const [key, value] of Object.entries(FailureCode)) {
      expect<string>(value).toBe(key);
    }
  });

  test("exposes the minimum required codes", () => {
    expect(Object.keys(FailureCode).sort()).toEqual(
      [
        "AMOUNT_MISMATCH",
        "CURRENCY_MISMATCH",
        "INSUFFICIENT_FUNDS",
        "INTERNAL_PERMANENT_ERROR",
        "INVALID_REFERENCE_KIND",
        "REFERENCE_ALREADY_REVERSED",
        "REFERENCE_MISMATCH",
        "REFERENCE_NOT_FOUND",
        "REFERENCE_NOT_PROCESSED",
        "REFERENCE_REQUIRED",
        "REVERSAL_WOULD_OVERDRAW",
        "WALLET_NOT_FOUND",
      ].sort(),
    );
  });
});
