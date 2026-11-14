import { describe, expect, test } from "bun:test";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { submitReference, submitReversal } from "../../../support/reversal-fixture";
import { brl, createSubmitFixture, type SubmitFixture } from "../../../support/submit-fixture";

function eventTypes(fixture: SubmitFixture): string[] {
  return fixture.unitOfWork.repositories.outbox.messages.map((message) => message.eventType);
}

describe("SubmitWagerTransaction outbox events", () => {
  test.each([TransactionKind.BET, TransactionKind.WIN])(
    "%s emits Processed and WalletBalanceChanged",
    async (kind) => {
      const fixture = await createSubmitFixture("100.00");

      await fixture.useCase.execute(fixture.input({ kind }));

      expect(eventTypes(fixture)).toEqual(["WagerTransactionProcessed", "WalletBalanceChanged"]);
    },
  );

  test("LOSS emits Processed without WalletBalanceChanged", async () => {
    const fixture = await createSubmitFixture("100.00");

    await fixture.useCase.execute(fixture.input({ kind: TransactionKind.LOSS }));

    expect(eventTypes(fixture)).toEqual(["WagerTransactionProcessed"]);
  });

  test("REFUND emits Processed and WalletBalanceChanged", async () => {
    const fixture = await createSubmitFixture("100.00");
    const bet = await submitReference(fixture, TransactionKind.BET, "10.00");

    await submitReversal(fixture, TransactionKind.REFUND, bet.externalTransactionId, "10.00");

    expect(eventTypes(fixture).slice(2)).toEqual([
      "WagerTransactionProcessed",
      "WalletBalanceChanged",
    ]);
  });

  test("a rejection emits only WagerTransactionRejected", async () => {
    const fixture = await createSubmitFixture("1.00");

    await fixture.useCase.execute(fixture.input({ money: brl("5.00") }));

    expect(eventTypes(fixture)).toEqual(["WagerTransactionRejected"]);
    expect(fixture.unitOfWork.repositories.outbox.messages[0]?.payload).toMatchObject({
      data: { failureCode: "INSUFFICIENT_FUNDS" },
    });
  });

  test("a missing reference emits only WagerTransactionPendingReference", async () => {
    const fixture = await createSubmitFixture("100.00");

    await submitReversal(fixture, TransactionKind.ROLLBACK, "never-sent", "10.00");

    expect(eventTypes(fixture)).toEqual(["WagerTransactionPendingReference"]);
  });

  test("replays and idempotency conflicts emit nothing new", async () => {
    const fixture = await createSubmitFixture("100.00");
    const input = fixture.input();
    await fixture.useCase.execute(input);

    await fixture.useCase.execute(input);
    await fixture.useCase.execute({ ...input, money: brl("1.00") });

    expect(eventTypes(fixture)).toHaveLength(2);
  });

  test("propagates correlationId and causationId and sets the aggregate per event", async () => {
    const fixture = await createSubmitFixture("100.00");

    const result = await fixture.useCase.execute(
      fixture.input({ context: { correlationId: "corr-42", causationId: "sqs-msg-7" } }),
    );

    const [processed, balanceChanged] = fixture.unitOfWork.repositories.outbox.messages;
    for (const message of [processed, balanceChanged]) {
      expect(message?.payload).toMatchObject({
        correlationId: "corr-42",
        causationId: "sqs-msg-7",
      });
    }
    expect(processed?.aggregateId).toBe(result.transactionId);
    expect(balanceChanged?.aggregateId).toBe(fixture.wallet.id);
    expect(processed?.id).not.toBe(balanceChanged?.id);
  });
});
