import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { Money } from "../../../../src/domain/money/money";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { LedgerDirection } from "../../../../src/domain/wallet/wallet-ledger-entry";
import { submitReference, submitReversal } from "../../../support/reversal-fixture";
import { brl, createSubmitFixture } from "../../../support/submit-fixture";

const REFUND = TransactionKind.REFUND;

describe("SubmitWagerTransaction REFUND", () => {
  test("credits back a processed BET and links the reference", async () => {
    const fixture = await createSubmitFixture("100.00");
    const bet = await submitReference(fixture, TransactionKind.BET, "30.00");

    const result = await submitReversal(fixture, REFUND, bet.externalTransactionId, "30.00");

    if (result.outcome !== "processed") throw new Error("expected processed");
    expect(result.balance.toJSON().amount).toBe("100.00");
    const last = fixture.unitOfWork.repositories.ledger.entries.at(-1);
    expect(last?.direction).toBe(LedgerDirection.CREDIT);
    const refund = await fixture.unitOfWork.repositories.transactions.findById(
      result.transactionId,
    );
    expect(refund?.referenceTransactionId).toBe(bet.result.transactionId);
  });

  test("rejects a refund of a WIN with INVALID_REFERENCE_KIND", async () => {
    const fixture = await createSubmitFixture("100.00");
    const win = await submitReference(fixture, TransactionKind.WIN, "5.00");

    const result = await submitReversal(fixture, REFUND, win.externalTransactionId, "5.00");

    expect(result).toMatchObject({
      outcome: "rejected",
      failureCode: FailureCode.INVALID_REFERENCE_KIND,
    });
  });

  test("rejects a refund of a rejected BET with REFERENCE_NOT_PROCESSED", async () => {
    const fixture = await createSubmitFixture("10.00");
    const bet = await submitReference(fixture, TransactionKind.BET, "50.00");

    const result = await submitReversal(fixture, REFUND, bet.externalTransactionId, "50.00");

    expect(result).toMatchObject({
      outcome: "rejected",
      failureCode: FailureCode.REFERENCE_NOT_PROCESSED,
    });
    expect(fixture.wallet.balance.toJSON().amount).toBe("10.00");
  });

  test("rejects a refund from another round with REFERENCE_MISMATCH", async () => {
    const fixture = await createSubmitFixture("100.00");
    const bet = await submitReference(fixture, TransactionKind.BET, "10.00");

    const result = await fixture.useCase.execute(
      fixture.input({
        kind: REFUND,
        money: brl("10.00"),
        roundId: "other-round",
        referenceExternalTransactionId: bet.externalTransactionId,
      }),
    );

    expect(result).toMatchObject({
      outcome: "rejected",
      failureCode: FailureCode.REFERENCE_MISMATCH,
    });
  });

  test("rejects a refund with another amount with AMOUNT_MISMATCH", async () => {
    const fixture = await createSubmitFixture("100.00");
    const bet = await submitReference(fixture, TransactionKind.BET, "10.00");

    const result = await submitReversal(fixture, REFUND, bet.externalTransactionId, "9.99");

    expect(result).toMatchObject({ outcome: "rejected", failureCode: FailureCode.AMOUNT_MISMATCH });
  });

  test("rejects a refund in another currency with CURRENCY_MISMATCH", async () => {
    const fixture = await createSubmitFixture("100.00");
    const bet = await submitReference(fixture, TransactionKind.BET, "10.00");

    const result = await fixture.useCase.execute(
      fixture.input({
        kind: REFUND,
        money: Money.from({ amount: "10.00", currency: "USD" }),
        referenceExternalTransactionId: bet.externalTransactionId,
      }),
    );

    expect(result).toMatchObject({
      outcome: "rejected",
      failureCode: FailureCode.CURRENCY_MISMATCH,
    });
  });

  test("rejects a second refund of the same BET with REFERENCE_ALREADY_REVERSED", async () => {
    const fixture = await createSubmitFixture("100.00");
    const bet = await submitReference(fixture, TransactionKind.BET, "10.00");
    await submitReversal(fixture, REFUND, bet.externalTransactionId, "10.00");

    const second = await submitReversal(fixture, REFUND, bet.externalTransactionId, "10.00");

    expect(second).toMatchObject({
      outcome: "rejected",
      failureCode: FailureCode.REFERENCE_ALREADY_REVERSED,
    });
    expect(fixture.wallet.balance.toJSON().amount).toBe("100.00");
  });

  test("treats a missing reference as pending", async () => {
    const fixture = await createSubmitFixture("100.00");

    const result = await submitReversal(fixture, REFUND, "never-sent", "10.00");

    expect(result).toMatchObject({ outcome: "pendingReference" });
  });

  test("treats a reference that is still pending as missing", async () => {
    const fixture = await createSubmitFixture("100.00");
    const pending = await fixture.useCase.execute(
      fixture.input({
        kind: REFUND,
        externalTransactionId: "pending-ref",
        referenceExternalTransactionId: "never-sent",
      }),
    );
    expect(pending.outcome).toBe("pendingReference");

    const result = await submitReversal(fixture, TransactionKind.ROLLBACK, "pending-ref", "10.00");

    expect(result).toMatchObject({ outcome: "pendingReference" });
  });
});
