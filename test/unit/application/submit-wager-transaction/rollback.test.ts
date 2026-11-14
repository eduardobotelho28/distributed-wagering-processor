import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import { LedgerDirection } from "../../../../src/domain/wallet/wallet-ledger-entry";
import { submitReference, submitReversal } from "../../../support/reversal-fixture";
import { brl, createSubmitFixture } from "../../../support/submit-fixture";

const ROLLBACK = TransactionKind.ROLLBACK;

describe("SubmitWagerTransaction ROLLBACK", () => {
  test("rolls back a BET with a CREDIT", async () => {
    const fixture = await createSubmitFixture("100.00");
    const bet = await submitReference(fixture, TransactionKind.BET, "40.00");

    const result = await submitReversal(fixture, ROLLBACK, bet.externalTransactionId, "40.00");

    expect(result).toMatchObject({ outcome: "processed" });
    expect(fixture.wallet.balance.toJSON().amount).toBe("100.00");
    const last = fixture.unitOfWork.repositories.ledger.entries.at(-1);
    expect(last?.direction).toBe(LedgerDirection.CREDIT);
  });

  test("rolls back a WIN with a DEBIT", async () => {
    const fixture = await createSubmitFixture("100.00");
    const win = await submitReference(fixture, TransactionKind.WIN, "15.00");

    const result = await submitReversal(fixture, ROLLBACK, win.externalTransactionId, "15.00");

    expect(result).toMatchObject({ outcome: "processed" });
    expect(fixture.wallet.balance.toJSON().amount).toBe("100.00");
    const last = fixture.unitOfWork.repositories.ledger.entries.at(-1);
    expect(last?.direction).toBe(LedgerDirection.DEBIT);
  });

  test("rolls back a REFUND with a DEBIT", async () => {
    const fixture = await createSubmitFixture("100.00");
    const bet = await submitReference(fixture, TransactionKind.BET, "20.00");
    await fixture.useCase.execute(
      fixture.input({
        kind: TransactionKind.REFUND,
        externalTransactionId: "refund-1",
        money: brl("20.00"),
        referenceExternalTransactionId: bet.externalTransactionId,
      }),
    );
    expect(fixture.wallet.balance.toJSON().amount).toBe("100.00");

    const result = await submitReversal(fixture, ROLLBACK, "refund-1", "20.00");

    expect(result).toMatchObject({ outcome: "processed" });
    expect(fixture.wallet.balance.toJSON().amount).toBe("80.00");
    const last = fixture.unitOfWork.repositories.ledger.entries.at(-1);
    expect(last?.direction).toBe(LedgerDirection.DEBIT);
  });

  test("rejects a rollback that would overdraw with REVERSAL_WOULD_OVERDRAW", async () => {
    const fixture = await createSubmitFixture("10.00");
    const win = await submitReference(fixture, TransactionKind.WIN, "50.00");
    await submitReference(fixture, TransactionKind.BET, "55.00");
    const ledgerSize = fixture.unitOfWork.repositories.ledger.entries.length;

    const result = await submitReversal(fixture, ROLLBACK, win.externalTransactionId, "50.00");

    expect(result).toMatchObject({
      outcome: "rejected",
      failureCode: FailureCode.REVERSAL_WOULD_OVERDRAW,
    });
    expect(fixture.unitOfWork.repositories.ledger.entries).toHaveLength(ledgerSize);
    expect(fixture.wallet.balance.toJSON().amount).toBe("5.00");
    const stored = await fixture.unitOfWork.repositories.transactions.findById(
      result.transactionId,
    );
    expect(stored?.status).toBe(TransactionStatus.REJECTED);
  });

  test("rejects a rollback of a BET that was already refunded", async () => {
    const fixture = await createSubmitFixture("100.00");
    const bet = await submitReference(fixture, TransactionKind.BET, "20.00");
    await submitReversal(fixture, TransactionKind.REFUND, bet.externalTransactionId, "20.00");

    const result = await submitReversal(fixture, ROLLBACK, bet.externalTransactionId, "20.00");

    expect(result).toMatchObject({
      outcome: "rejected",
      failureCode: FailureCode.REFERENCE_ALREADY_REVERSED,
    });
    expect(fixture.wallet.balance.toJSON().amount).toBe("100.00");
  });
});
