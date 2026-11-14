import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { InvalidTransactionStateError } from "../../../../src/domain/errors/invalid-transaction-state.error";
import { Money } from "../../../../src/domain/money/money";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import { WagerTransaction } from "../../../../src/domain/transaction/wager-transaction";

const now = new Date("2026-01-02T00:00:00Z");

const inStatus = (status: TransactionStatus): WagerTransaction =>
  WagerTransaction.rehydrate({
    id: "t-1",
    idempotencyKey: "idem-1",
    providerId: "prov-1",
    externalTransactionId: "ext-1",
    playerId: "p-1",
    walletId: "w-1",
    roundId: "r-1",
    gameId: "g-1",
    kind: TransactionKind.REFUND,
    money: Money.from({ amount: "10.00", currency: "BRL" }),
    referenceExternalTransactionId: "ext-0",
    payloadHash: "hash-1",
    status,
    referenceTransactionId: null,
    failureCode: null,
    processedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });

const actions = {
  markProcessed: (tx: WagerTransaction) => tx.markProcessed(now, "t-0"),
  markPendingReference: (tx: WagerTransaction) => tx.markPendingReference(),
  reject: (tx: WagerTransaction) => tx.reject(FailureCode.REFERENCE_MISMATCH),
  fail: (tx: WagerTransaction) => tx.fail(FailureCode.INTERNAL_PERMANENT_ERROR),
};

type Action = keyof typeof actions;

const allowed: Record<TransactionStatus, Partial<Record<Action, TransactionStatus>>> = {
  [TransactionStatus.PENDING]: {
    markProcessed: TransactionStatus.PROCESSED,
    markPendingReference: TransactionStatus.PENDING_REFERENCE,
    reject: TransactionStatus.REJECTED,
    fail: TransactionStatus.FAILED,
  },
  [TransactionStatus.PENDING_REFERENCE]: {
    markProcessed: TransactionStatus.PROCESSED,
    reject: TransactionStatus.REJECTED,
    fail: TransactionStatus.FAILED,
  },
  [TransactionStatus.PROCESSED]: {},
  [TransactionStatus.REJECTED]: {},
  [TransactionStatus.FAILED]: {},
};

const actionNames: Action[] = ["markProcessed", "markPendingReference", "reject", "fail"];

describe("WagerTransaction transitions", () => {
  for (const from of Object.values(TransactionStatus)) {
    for (const action of actionNames) {
      const to = allowed[from][action];
      if (to === undefined) {
        test(`throws when calling ${action} from ${from}`, () => {
          const tx = inStatus(from);
          expect(() => actions[action](tx)).toThrow(InvalidTransactionStateError);
          expect(tx.status).toBe(from);
        });
        continue;
      }
      test(`moves from ${from} to ${to} on ${action}`, () => {
        const tx = inStatus(from);
        actions[action](tx);
        expect(tx.status).toBe(to);
      });
    }
  }

  test("reports terminal only for PROCESSED, REJECTED and FAILED", () => {
    const terminal = Object.values(TransactionStatus).filter((s) => inStatus(s).isTerminal());
    expect(terminal).toEqual([
      TransactionStatus.PROCESSED,
      TransactionStatus.REJECTED,
      TransactionStatus.FAILED,
    ]);
  });

  test("markProcessed stores the resolved reference and the processing time", () => {
    const tx = inStatus(TransactionStatus.PENDING_REFERENCE);
    tx.markProcessed(now, "t-0");
    expect(tx.referenceTransactionId).toBe("t-0");
    expect(tx.processedAt).toEqual(now);
    expect(tx.failureCode).toBeNull();
  });

  test("reject and fail store the failure code without a processing time", () => {
    const rejected = inStatus(TransactionStatus.PENDING);
    rejected.reject(FailureCode.REFERENCE_MISMATCH);
    const failed = inStatus(TransactionStatus.PENDING);
    failed.fail(FailureCode.INTERNAL_PERMANENT_ERROR);
    expect(rejected.failureCode).toBe(FailureCode.REFERENCE_MISMATCH);
    expect(failed.failureCode).toBe(FailureCode.INTERNAL_PERMANENT_ERROR);
    expect(rejected.processedAt).toBeNull();
  });
});
