import { describe, expect, test } from "bun:test";
import { ReprocessPendingReferenceUseCase } from "../../../src/application/reprocess-pending-reference/reprocess-pending-reference.use-case";
import {
  PENDING_REFERENCE_BASE_DELAY_MS,
  PENDING_REFERENCE_MAX_ATTEMPTS,
  PENDING_REFERENCE_MAX_DELAY_MS,
  PENDING_REFERENCE_TTL_MS,
  nextPendingAttemptAt,
} from "../../../src/application/wager-processing/pending-reference-policy";
import { FailureCode } from "../../../src/domain/errors/failure-code";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../src/domain/transaction/transaction-status";
import { submitReversal } from "../../support/reversal-fixture";
import { brl, createSubmitFixture, type SubmitFixture } from "../../support/submit-fixture";

interface PendingSetup {
  fixture: SubmitFixture;
  reprocess: ReprocessPendingReferenceUseCase;
  pendingId: string;
}

async function pendingRefund(referenceExternalId = "bet-late"): Promise<PendingSetup> {
  const fixture = await createSubmitFixture("100.00");
  const pending = await submitReversal(
    fixture,
    TransactionKind.REFUND,
    referenceExternalId,
    "30.00",
  );
  const reprocess = new ReprocessPendingReferenceUseCase(
    fixture.unitOfWork,
    fixture.clock,
    fixture.ids,
  );
  return { fixture, reprocess, pendingId: pending.transactionId };
}

function storedOf(fixture: SubmitFixture, id: string) {
  return fixture.unitOfWork.repositories.transactions.rows.get(id);
}

function advanceToNextAttempt(fixture: SubmitFixture, id: string): void {
  const next = storedOf(fixture, id)?.state.nextAttemptAt;
  if (next === null || next === undefined) throw new Error("no attempt scheduled");
  fixture.clock.advance(next.getTime() - fixture.clock.now().getTime());
}

describe("pending reference backoff", () => {
  test("doubles from the base delay and stops at the cap", () => {
    const now = new Date("2026-11-14T12:00:00.000Z");
    const delays = [0, 1, 2, 7, 20].map(
      (attempts) => nextPendingAttemptAt(attempts, now).getTime() - now.getTime(),
    );

    expect(delays).toEqual([
      PENDING_REFERENCE_BASE_DELAY_MS,
      PENDING_REFERENCE_BASE_DELAY_MS * 2,
      PENDING_REFERENCE_BASE_DELAY_MS * 4,
      PENDING_REFERENCE_MAX_DELAY_MS,
      PENDING_REFERENCE_MAX_DELAY_MS,
    ]);
  });
});

describe("ReprocessPendingReferenceUseCase", () => {
  test("is idle while no pending transaction is due", async () => {
    const { reprocess } = await pendingRefund();

    expect(await reprocess.execute()).toEqual({ outcome: "idle" });
  });

  test("processes the transaction normally once the reference arrives", async () => {
    const { fixture, reprocess, pendingId } = await pendingRefund("bet-late");
    await fixture.useCase.execute(
      fixture.input({ externalTransactionId: "bet-late", money: brl("30.00") }),
    );
    advanceToNextAttempt(fixture, pendingId);

    const result = await reprocess.execute();

    expect(result).toMatchObject({ outcome: "attempted", result: { outcome: "processed" } });
    expect(storedOf(fixture, pendingId)?.transaction.status).toBe(TransactionStatus.PROCESSED);
    expect(fixture.wallet.balance.toJSON().amount).toBe("100.00");
    const types = fixture.unitOfWork.repositories.outbox.messages.map((m) => m.eventType);
    expect(types.slice(-2)).toEqual(["WagerTransactionProcessed", "WalletBalanceChanged"]);
  });

  test("reschedules with backoff while the reference is still missing", async () => {
    const { fixture, reprocess, pendingId } = await pendingRefund();
    advanceToNextAttempt(fixture, pendingId);
    const now = fixture.clock.now();

    const result = await reprocess.execute();

    expect(result).toMatchObject({ outcome: "attempted", result: { outcome: "pendingReference" } });
    expect(storedOf(fixture, pendingId)?.state).toEqual({
      resultingBalance: null,
      pendingAttempts: 1,
      nextAttemptAt: nextPendingAttemptAt(1, now),
    });
    expect(storedOf(fixture, pendingId)?.transaction.status).toBe(
      TransactionStatus.PENDING_REFERENCE,
    );
  });

  test("rejects with REFERENCE_NOT_FOUND after the attempt limit and emits Rejected", async () => {
    const { fixture, reprocess, pendingId } = await pendingRefund();
    let last = null;
    for (let attempt = 0; attempt < PENDING_REFERENCE_MAX_ATTEMPTS; attempt += 1) {
      advanceToNextAttempt(fixture, pendingId);
      last = await reprocess.execute();
    }

    expect(last).toMatchObject({
      outcome: "attempted",
      result: { outcome: "rejected", failureCode: FailureCode.REFERENCE_NOT_FOUND },
    });
    expect(storedOf(fixture, pendingId)?.transaction.status).toBe(TransactionStatus.REJECTED);
    const types = fixture.unitOfWork.repositories.outbox.messages.map((m) => m.eventType);
    expect(types.at(-1)).toBe("WagerTransactionRejected");
    expect(await reprocess.execute()).toEqual({ outcome: "idle" });
  });

  test("rejects with REFERENCE_NOT_FOUND once the TTL has passed", async () => {
    const { fixture, reprocess, pendingId } = await pendingRefund();
    fixture.clock.advance(PENDING_REFERENCE_TTL_MS);

    const result = await reprocess.execute();

    expect(result).toMatchObject({
      result: { outcome: "rejected", failureCode: FailureCode.REFERENCE_NOT_FOUND },
    });
    expect(storedOf(fixture, pendingId)?.state.pendingAttempts).toBe(0);
  });
});
