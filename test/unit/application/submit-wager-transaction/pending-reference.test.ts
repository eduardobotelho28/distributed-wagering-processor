import { describe, expect, test } from "bun:test";
import { PENDING_REFERENCE_BASE_DELAY_MS } from "../../../../src/application/wager-processing/pending-reference-policy";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import { FIXED_NOW } from "../../../support/factories";
import { submitReversal } from "../../../support/reversal-fixture";
import { createSubmitFixture } from "../../../support/submit-fixture";

describe("SubmitWagerTransaction reference not found", () => {
  test("persists PENDING_REFERENCE with the first retry scheduled and no movement", async () => {
    const fixture = await createSubmitFixture("100.00");

    const result = await submitReversal(fixture, TransactionKind.REFUND, "never-sent", "10.00");

    expect(result).toEqual({
      outcome: "pendingReference",
      transactionId: result.transactionId,
      idempotentReplay: false,
    });
    const stored = fixture.unitOfWork.repositories.transactions.rows.get(result.transactionId);
    expect(stored?.transaction.status).toBe(TransactionStatus.PENDING_REFERENCE);
    expect(stored?.state).toEqual({
      resultingBalance: null,
      pendingAttempts: 0,
      nextAttemptAt: new Date(FIXED_NOW.getTime() + PENDING_REFERENCE_BASE_DELAY_MS),
    });
    expect(fixture.unitOfWork.repositories.ledger.entries).toHaveLength(1);
    expect(fixture.wallet.balance.toJSON().amount).toBe("100.00");
  });

  test("enqueues a WagerTransactionPendingReference event for the transaction", async () => {
    const fixture = await createSubmitFixture("100.00");

    const result = await submitReversal(fixture, TransactionKind.ROLLBACK, "never-sent", "10.00");

    const messages = fixture.unitOfWork.repositories.outbox.messages;
    expect(messages.map((message) => message.eventType)).toEqual([
      "WagerTransactionPendingReference",
    ]);
    expect(messages[0]?.aggregateId).toBe(result.transactionId);
    expect(messages[0]?.payload).toMatchObject({
      data: {
        transactionId: result.transactionId,
        walletId: fixture.wallet.id,
        kind: TransactionKind.ROLLBACK,
        amount: { amount: "10.00", currency: "BRL" },
        referenceExternalTransactionId: "never-sent",
      },
    });
  });

  test("replays a pending submission without a second event", async () => {
    const fixture = await createSubmitFixture("100.00");
    const input = fixture.input({
      kind: TransactionKind.REFUND,
      referenceExternalTransactionId: "never-sent",
    });
    const first = await fixture.useCase.execute(input);

    const replay = await fixture.useCase.execute(input);

    expect(replay).toEqual({ ...first, idempotentReplay: true });
    expect(fixture.unitOfWork.repositories.outbox.messages).toHaveLength(1);
  });
});
