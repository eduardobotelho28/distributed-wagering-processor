import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { Money } from "../../../../src/domain/money/money";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import { brl, createSubmitFixture } from "../../../support/submit-fixture";

describe("SubmitWagerTransaction idempotency", () => {
  test("processes the first call and stores the resulting balance", async () => {
    const fixture = await createSubmitFixture("100.00");

    const result = await fixture.useCase.execute(fixture.input({ kind: TransactionKind.WIN }));

    if (result.outcome !== "processed") throw new Error("expected processed");
    expect(result.balance.toJSON().amount).toBe("110.00");
    expect(result.idempotentReplay).toBe(false);
    const stored = await fixture.unitOfWork.repositories.transactions.findById(
      result.transactionId,
    );
    expect(stored?.status).toBe(TransactionStatus.PROCESSED);
  });

  test("replays an identical request with the stored balance and no new movement", async () => {
    const fixture = await createSubmitFixture("100.00");
    const input = fixture.input({ kind: TransactionKind.WIN });
    const first = await fixture.useCase.execute(input);
    await fixture.useCase.execute(fixture.input({ kind: TransactionKind.WIN }));

    const replay = await fixture.useCase.execute(input);

    expect(replay).toEqual({ ...first, idempotentReplay: true });
    if (replay.outcome !== "processed") throw new Error("expected processed");
    expect(replay.balance.toJSON().amount).toBe("110.00");
    expect(fixture.unitOfWork.repositories.ledger.entries).toHaveLength(3);
  });

  test("returns a conflict when the same key comes with a different payload", async () => {
    const fixture = await createSubmitFixture("100.00");
    const input = fixture.input({ kind: TransactionKind.WIN });
    const first = await fixture.useCase.execute(input);

    const conflict = await fixture.useCase.execute({ ...input, money: brl("99.00") });

    expect(conflict).toEqual({
      outcome: "idempotencyConflict",
      transactionId: first.transactionId,
      idempotentReplay: false,
    });
    expect(fixture.unitOfWork.repositories.ledger.entries).toHaveLength(2);
  });

  test("rejects and records an unknown wallet, then replays the rejection", async () => {
    const fixture = await createSubmitFixture();
    const input = fixture.input({ walletId: "missing-wallet" });

    const first = await fixture.useCase.execute(input);
    const replay = await fixture.useCase.execute(input);

    expect(first).toMatchObject({
      outcome: "rejected",
      failureCode: FailureCode.WALLET_NOT_FOUND,
      balance: null,
    });
    expect(replay).toEqual({ ...first, idempotentReplay: true });
  });

  test("rejects a currency different from the wallet without moving the balance", async () => {
    const fixture = await createSubmitFixture("100.00");
    const usd = Money.from({ amount: "1.00", currency: "USD" });

    const result = await fixture.useCase.execute(
      fixture.input({ kind: TransactionKind.WIN, money: usd }),
    );

    expect(result).toMatchObject({
      outcome: "rejected",
      failureCode: FailureCode.CURRENCY_MISMATCH,
    });
    expect(fixture.unitOfWork.repositories.ledger.entries).toHaveLength(1);
    expect(fixture.wallet.balance.toJSON().amount).toBe("100.00");
  });
});
