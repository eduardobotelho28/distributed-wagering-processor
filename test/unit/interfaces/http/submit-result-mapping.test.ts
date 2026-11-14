import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { Money } from "../../../../src/domain/money/money";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import { ApiError } from "../../../../src/interfaces/http/errors/api-error";
import { submitResultToHttp } from "../../../../src/interfaces/http/mappers/submit-result.mapper";

const balance = Money.from({ amount: "975.00", currency: "BRL" });

function thrownBy(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) return error;
  }
  throw new Error("expected ApiError");
}

describe("submitResultToHttp", () => {
  test("maps a first processed transaction to 201 with the README body", () => {
    const reply = submitResultToHttp({
      outcome: "processed",
      transactionId: "tx-1",
      balance,
      idempotentReplay: false,
    });

    expect(reply).toEqual({
      status: 201,
      body: {
        transactionId: "tx-1",
        status: TransactionStatus.PROCESSED,
        balance: { amount: "975.00", currency: "BRL" },
        idempotentReplay: false,
      },
    });
  });

  test("maps a processed replay to 200 with idempotentReplay true", () => {
    const reply = submitResultToHttp({
      outcome: "processed",
      transactionId: "tx-1",
      balance,
      idempotentReplay: true,
    });

    expect(reply.status).toBe(200);
    expect(reply.body.idempotentReplay).toBe(true);
  });

  test("maps a pending reference to 202", () => {
    const reply = submitResultToHttp({
      outcome: "pendingReference",
      transactionId: "tx-2",
      idempotentReplay: false,
    });

    expect(reply).toEqual({
      status: 202,
      body: {
        transactionId: "tx-2",
        status: TransactionStatus.PENDING_REFERENCE,
        balance: null,
        idempotentReplay: false,
      },
    });
  });

  test.each([false, true])(
    "maps a rejection (replay %p) to 422 with the failure code",
    (replay) => {
      const reply = submitResultToHttp({
        outcome: "rejected",
        transactionId: "tx-3",
        failureCode: FailureCode.INSUFFICIENT_FUNDS,
        balance,
        idempotentReplay: replay,
      });

      expect(reply).toEqual({
        status: 422,
        body: {
          transactionId: "tx-3",
          status: TransactionStatus.REJECTED,
          balance: { amount: "975.00", currency: "BRL" },
          idempotentReplay: replay,
          code: "INSUFFICIENT_FUNDS",
          message: "transaction rejected by business rule",
          retryable: false,
        },
      });
    },
  );

  test("maps a permanent failure to 500 not retryable", () => {
    const reply = submitResultToHttp({
      outcome: "failed",
      transactionId: "tx-4",
      failureCode: FailureCode.INTERNAL_PERMANENT_ERROR,
      idempotentReplay: false,
    });

    expect(reply.status).toBe(500);
    expect(reply.body).toMatchObject({
      status: TransactionStatus.FAILED,
      code: "INTERNAL_PERMANENT_ERROR",
      retryable: false,
    });
  });

  test("maps an idempotency conflict to 409", () => {
    const error = thrownBy(() =>
      submitResultToHttp({
        outcome: "idempotencyConflict",
        transactionId: "tx-5",
        idempotentReplay: false,
      }),
    );

    expect(error.status).toBe(409);
    expect(error.toBody()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", retryable: false });
  });

  test("maps an invalid payload to 400 with the specific reason", () => {
    const error = thrownBy(() =>
      submitResultToHttp({ outcome: "invalidPayload", reason: FailureCode.REFERENCE_REQUIRED }),
    );

    expect(error.status).toBe(400);
    expect(error.code).toBe("REFERENCE_REQUIRED");
  });
});
