import { describe, expect, test } from "bun:test";
import { InvariantViolationError } from "../../../../src/domain/errors/invariant-violation.error";
import { Money } from "../../../../src/domain/money/money";
import { ReferenceRequiredError } from "../../../../src/domain/transaction/reference-required.error";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import {
  type CreateWagerTransactionInput,
  type OpenWagerTransactionInput,
  WagerTransaction,
} from "../../../../src/domain/transaction/wager-transaction";

const openingInput = (): OpenWagerTransactionInput => ({
  id: "t-1",
  idempotencyKey: "idem-1",
  providerId: "prov-1",
  externalTransactionId: "ext-1",
  playerId: "p-1",
  walletId: "w-1",
  roundId: "r-1",
  gameId: "g-1",
  money: Money.from({ amount: "10.00", currency: "BRL" }),
  payloadHash: "hash-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const input = (
  overrides: Partial<CreateWagerTransactionInput> = {},
): CreateWagerTransactionInput => ({
  ...openingInput(),
  kind: TransactionKind.BET,
  referenceExternalTransactionId: null,
  ...overrides,
});

const cases = [
  { kind: TransactionKind.BET, requiresReference: false, affectsBalance: true },
  { kind: TransactionKind.WIN, requiresReference: false, affectsBalance: true },
  { kind: TransactionKind.LOSS, requiresReference: false, affectsBalance: false },
  { kind: TransactionKind.REFUND, requiresReference: true, affectsBalance: true },
  { kind: TransactionKind.ROLLBACK, requiresReference: true, affectsBalance: true },
];

describe("WagerTransaction.create", () => {
  for (const { kind, requiresReference, affectsBalance } of cases) {
    test(`creates a ${kind} born PENDING with its reference and balance rules`, () => {
      const reference = requiresReference ? "ext-0" : null;
      const tx = WagerTransaction.create(
        input({ kind, referenceExternalTransactionId: reference }),
      );
      expect(tx.status).toBe(TransactionStatus.PENDING);
      expect(tx.kind).toBe(kind);
      expect(tx.requiresReference()).toBe(requiresReference);
      expect(tx.affectsBalance()).toBe(affectsBalance);
      expect(tx.referenceExternalTransactionId).toBe(reference);
    });
  }

  for (const kind of [TransactionKind.REFUND, TransactionKind.ROLLBACK]) {
    test(`rejects a ${kind} without a reference`, () => {
      expect(() => WagerTransaction.create(input({ kind }))).toThrow(ReferenceRequiredError);
    });
  }

  test("rejects OPENING from external creation", () => {
    expect(() => WagerTransaction.create(input({ kind: TransactionKind.OPENING }))).toThrow(
      InvariantViolationError,
    );
  });

  test("does not share the createdAt instance with the caller", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const tx = WagerTransaction.create(input({ createdAt }));
    createdAt.setFullYear(2000);
    expect(tx.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("WagerTransaction.opening", () => {
  test("creates an OPENING born PENDING without reference that affects the balance", () => {
    const tx = WagerTransaction.opening(openingInput());
    expect(tx.kind).toBe(TransactionKind.OPENING);
    expect(tx.status).toBe(TransactionStatus.PENDING);
    expect(tx.referenceExternalTransactionId).toBeNull();
    expect(tx.requiresReference()).toBe(false);
    expect(tx.affectsBalance()).toBe(true);
  });
});

describe("WagerTransaction.rehydrate", () => {
  test("restores the stored state without revalidating", () => {
    const tx = WagerTransaction.rehydrate({
      ...input({ kind: TransactionKind.ROLLBACK }),
      status: TransactionStatus.PROCESSED,
    });
    expect(tx.status).toBe(TransactionStatus.PROCESSED);
    expect(tx.referenceExternalTransactionId).toBeNull();
  });
});
