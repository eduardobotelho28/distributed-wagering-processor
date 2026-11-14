import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { InvariantViolationError } from "../../../../src/domain/errors/invariant-violation.error";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import { brl, createSubmitFixture, type SubmitFixture } from "../../../support/submit-fixture";

function failNextInsert(fixture: SubmitFixture, error: Error): void {
  const transactions = fixture.unitOfWork.repositories.transactions;
  const realInsert = transactions.insert.bind(transactions);
  let failed = false;
  transactions.insert = async (transaction, state) => {
    if (!failed) {
      failed = true;
      throw error;
    }
    return realInsert(transaction, state);
  };
}

describe("SubmitWagerTransaction payload validation", () => {
  test("rejects OPENING from outside without recording anything", async () => {
    const fixture = await createSubmitFixture("100.00");
    const before = fixture.unitOfWork.repositories.transactions.rows.size;

    const result = await fixture.rawUseCase.execute(
      fixture.input({ kind: TransactionKind.OPENING }),
    );

    expect(result).toEqual({ outcome: "invalidPayload", reason: "OPENING_NOT_ALLOWED" });
    expect(fixture.unitOfWork.repositories.transactions.rows.size).toBe(before);
  });

  test.each([TransactionKind.REFUND, TransactionKind.ROLLBACK])(
    "rejects %s without reference with REFERENCE_REQUIRED",
    async (kind) => {
      const fixture = await createSubmitFixture("100.00");

      const result = await fixture.rawUseCase.execute(
        fixture.input({ kind, referenceExternalTransactionId: null }),
      );

      expect(result).toEqual({
        outcome: "invalidPayload",
        reason: FailureCode.REFERENCE_REQUIRED,
      });
    },
  );

  test("rejects a blank required field", async () => {
    const fixture = await createSubmitFixture("100.00");

    const result = await fixture.rawUseCase.execute(fixture.input({ roundId: "  " }));

    expect(result).toEqual({ outcome: "invalidPayload", reason: "BLANK_FIELD" });
  });

  test("rejects a zero amount for a balance movement", async () => {
    const fixture = await createSubmitFixture("100.00");

    const result = await fixture.rawUseCase.execute(fixture.input({ money: brl("0.00") }));

    expect(result).toEqual({ outcome: "invalidPayload", reason: "AMOUNT_NOT_POSITIVE" });
  });

  test("accepts a zero-amount LOSS", async () => {
    const fixture = await createSubmitFixture("100.00");

    const result = await fixture.rawUseCase.execute(
      fixture.input({ kind: TransactionKind.LOSS, money: brl("0.00") }),
    );

    expect(result.outcome).toBe("processed");
  });
});

describe("SubmitWagerTransaction permanent and transient failures", () => {
  test("records FAILED with INTERNAL_PERMANENT_ERROR on a domain error", async () => {
    const fixture = await createSubmitFixture("100.00");
    failNextInsert(fixture, new InvariantViolationError("simulated bug"));
    const input = fixture.input();

    const result = await fixture.useCase.execute(input);

    expect(result).toMatchObject({
      outcome: "failed",
      failureCode: FailureCode.INTERNAL_PERMANENT_ERROR,
      idempotentReplay: false,
    });
    const stored = await fixture.unitOfWork.repositories.transactions.findById(
      result.transactionId,
    );
    expect(stored?.status).toBe(TransactionStatus.FAILED);
    const events = fixture.unitOfWork.repositories.outbox.messages.map((m) => m.eventType);
    expect(events).toContain("WagerTransactionRejected");
  });

  test("replays a FAILED transaction as failed", async () => {
    const fixture = await createSubmitFixture("100.00");
    failNextInsert(fixture, new InvariantViolationError("simulated bug"));
    const input = fixture.input();
    const first = await fixture.useCase.execute(input);

    const replay = await fixture.useCase.execute(input);

    expect(replay).toEqual({ ...first, idempotentReplay: true });
  });

  test("rethrows a transient error without recording a failure", async () => {
    const fixture = await createSubmitFixture("100.00");
    const before = fixture.unitOfWork.repositories.transactions.rows.size;
    failNextInsert(fixture, new Error("connection reset"));

    await expect(fixture.useCase.execute(fixture.input())).rejects.toThrow("connection reset");
    expect(fixture.unitOfWork.repositories.transactions.rows.size).toBe(before);
  });
});
