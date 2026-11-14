import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { Money } from "../../../../src/domain/money/money";
import { checkReversal } from "../../../../src/domain/transaction/reversal-policy";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import {
  WagerTransaction,
  type CreateWagerTransactionInput,
} from "../../../../src/domain/transaction/wager-transaction";

const NOW = new Date("2026-01-01T00:00:00Z");

const build = (
  kind: TransactionKind,
  overrides: Partial<CreateWagerTransactionInput> = {},
): WagerTransaction =>
  WagerTransaction.create({
    id: "t-1",
    idempotencyKey: "idem-1",
    providerId: "prov-1",
    externalTransactionId: "ext-1",
    playerId: "p-1",
    walletId: "w-1",
    roundId: "r-1",
    gameId: "g-1",
    kind,
    money: Money.from({ amount: "10.00", currency: "BRL" }),
    referenceExternalTransactionId:
      kind === TransactionKind.REFUND || kind === TransactionKind.ROLLBACK ? "ext-0" : null,
    payloadHash: "hash-1",
    createdAt: NOW,
    ...overrides,
  });

const processed = (
  kind: TransactionKind,
  overrides: Partial<CreateWagerTransactionInput> = {},
): WagerTransaction => {
  const transaction = build(kind, overrides);
  transaction.markProcessed(NOW, null);
  return transaction;
};

describe("checkReversal", () => {
  const allowed = [
    [TransactionKind.REFUND, TransactionKind.BET],
    [TransactionKind.ROLLBACK, TransactionKind.BET],
    [TransactionKind.ROLLBACK, TransactionKind.WIN],
    [TransactionKind.ROLLBACK, TransactionKind.REFUND],
  ] as const;
  for (const [reversal, reference] of allowed) {
    test(`accepts a ${reversal} of a processed ${reference}`, () => {
      expect(checkReversal(build(reversal), processed(reference))).toEqual({ ok: true });
    });
  }

  test("rejects with INVALID_REFERENCE_KIND when a REFUND targets a WIN", () => {
    expect(checkReversal(build(TransactionKind.REFUND), processed(TransactionKind.WIN))).toEqual({
      ok: false,
      failureCode: FailureCode.INVALID_REFERENCE_KIND,
    });
  });

  test("rejects with REFERENCE_NOT_PROCESSED when the reference was rejected", () => {
    const reference = build(TransactionKind.BET);
    reference.reject(FailureCode.INSUFFICIENT_FUNDS);
    expect(checkReversal(build(TransactionKind.REFUND), reference)).toEqual({
      ok: false,
      failureCode: FailureCode.REFERENCE_NOT_PROCESSED,
    });
  });

  const ownershipFields = ["providerId", "playerId", "walletId", "roundId"] as const;
  for (const field of ownershipFields) {
    test(`rejects with REFERENCE_MISMATCH when ${field} differs`, () => {
      const reference = processed(TransactionKind.BET, { [field]: "other" });
      expect(checkReversal(build(TransactionKind.REFUND), reference)).toEqual({
        ok: false,
        failureCode: FailureCode.REFERENCE_MISMATCH,
      });
    });
  }

  test("rejects with CURRENCY_MISMATCH when currencies differ", () => {
    const reference = processed(TransactionKind.BET, {
      money: Money.from({ amount: "10.00", currency: "USD" }),
    });
    expect(checkReversal(build(TransactionKind.REFUND), reference)).toEqual({
      ok: false,
      failureCode: FailureCode.CURRENCY_MISMATCH,
    });
  });

  test("rejects with AMOUNT_MISMATCH when amounts differ", () => {
    const reference = processed(TransactionKind.BET, {
      money: Money.from({ amount: "10.01", currency: "BRL" }),
    });
    expect(checkReversal(build(TransactionKind.REFUND), reference)).toEqual({
      ok: false,
      failureCode: FailureCode.AMOUNT_MISMATCH,
    });
  });
});
