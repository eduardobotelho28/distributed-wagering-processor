import { describe, expect, test } from "bun:test";
import { InvariantViolationError } from "../../../../src/domain/errors/invariant-violation.error";
import { Money } from "../../../../src/domain/money/money";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { WagerTransaction } from "../../../../src/domain/transaction/wager-transaction";
import { LedgerDirection } from "../../../../src/domain/wallet/wallet-ledger-entry";

const build = (kind: TransactionKind, id = "t-1"): WagerTransaction => {
  const base = {
    id,
    idempotencyKey: `idem-${id}`,
    providerId: "prov-1",
    externalTransactionId: `ext-${id}`,
    playerId: "p-1",
    walletId: "w-1",
    roundId: "r-1",
    gameId: "g-1",
    money: Money.from({ amount: "10.00", currency: "BRL" }),
    payloadHash: "hash-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  if (kind === TransactionKind.OPENING) {
    return WagerTransaction.opening(base);
  }
  const reference =
    kind === TransactionKind.REFUND || kind === TransactionKind.ROLLBACK ? "ext-0" : null;
  return WagerTransaction.create({ ...base, kind, referenceExternalTransactionId: reference });
};

describe("WagerTransaction.ledgerDirectionFor", () => {
  const direct = [
    { kind: TransactionKind.BET, expected: LedgerDirection.DEBIT },
    { kind: TransactionKind.WIN, expected: LedgerDirection.CREDIT },
    { kind: TransactionKind.REFUND, expected: LedgerDirection.CREDIT },
    { kind: TransactionKind.OPENING, expected: LedgerDirection.CREDIT },
  ];
  for (const { kind, expected } of direct) {
    test(`returns ${expected} for ${kind}`, () => {
      expect(build(kind).ledgerDirectionFor()).toBe(expected);
    });
  }

  const rollbacks = [
    { reference: TransactionKind.BET, expected: LedgerDirection.CREDIT },
    { reference: TransactionKind.WIN, expected: LedgerDirection.DEBIT },
    { reference: TransactionKind.REFUND, expected: LedgerDirection.DEBIT },
  ];
  for (const { reference, expected } of rollbacks) {
    test(`ROLLBACK of a ${reference} returns ${expected}`, () => {
      const rollback = build(TransactionKind.ROLLBACK);
      expect(rollback.ledgerDirectionFor(build(reference, "t-0"))).toBe(expected);
    });
  }

  const invalidReferences = [
    TransactionKind.LOSS,
    TransactionKind.ROLLBACK,
    TransactionKind.OPENING,
  ];
  for (const reference of invalidReferences) {
    test(`ROLLBACK of a ${reference} throws an invariant violation`, () => {
      const rollback = build(TransactionKind.ROLLBACK);
      expect(() => rollback.ledgerDirectionFor(build(reference, "t-0"))).toThrow(
        InvariantViolationError,
      );
    });
  }

  test("ROLLBACK without a reference throws an invariant violation", () => {
    expect(() => build(TransactionKind.ROLLBACK).ledgerDirectionFor()).toThrow(
      InvariantViolationError,
    );
  });

  test("LOSS has no ledger direction", () => {
    expect(() => build(TransactionKind.LOSS).ledgerDirectionFor()).toThrow(InvariantViolationError);
  });
});

describe("WagerTransaction.matchesPayload", () => {
  test("matches the stored payload hash", () => {
    expect(build(TransactionKind.BET).matchesPayload("hash-1")).toBe(true);
  });

  test("does not match a different payload hash", () => {
    expect(build(TransactionKind.BET).matchesPayload("hash-2")).toBe(false);
  });
});
