import { describe, expect, test } from "bun:test";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import { LedgerDirection } from "../../../../src/domain/wallet/wallet-ledger-entry";
import { brl, createSubmitFixture } from "../../../support/submit-fixture";

describe("SubmitWagerTransaction WIN", () => {
  test("credits the wallet with a CREDIT entry", async () => {
    const fixture = await createSubmitFixture("100.00");

    const result = await fixture.useCase.execute(
      fixture.input({ kind: TransactionKind.WIN, money: brl("0.10") }),
    );

    if (result.outcome !== "processed") throw new Error("expected processed");
    expect(result.balance.toJSON().amount).toBe("100.10");
    const last = fixture.unitOfWork.repositories.ledger.entries.at(-1);
    expect(last?.direction).toBe(LedgerDirection.CREDIT);
    expect(last?.transactionId).toBe(result.transactionId);
  });
});

describe("SubmitWagerTransaction LOSS", () => {
  test("marks PROCESSED with no ledger row and no balance change", async () => {
    const fixture = await createSubmitFixture("100.00");

    const result = await fixture.useCase.execute(
      fixture.input({ kind: TransactionKind.LOSS, money: brl("25.00") }),
    );

    if (result.outcome !== "processed") throw new Error("expected processed");
    expect(result.balance.toJSON().amount).toBe("100.00");
    const entries = fixture.unitOfWork.repositories.ledger.entries;
    expect(entries.filter((entry) => entry.transactionId === result.transactionId)).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(fixture.wallet.version).toBe(1);
    const stored = fixture.unitOfWork.repositories.transactions.rows.get(result.transactionId);
    expect(stored?.transaction.status).toBe(TransactionStatus.PROCESSED);
    expect(stored?.state.resultingBalance?.toJSON().amount).toBe("100.00");
  });

  test("processes a LOSS even when the amount exceeds the balance", async () => {
    const fixture = await createSubmitFixture("1.00");

    const result = await fixture.useCase.execute(
      fixture.input({ kind: TransactionKind.LOSS, money: brl("50.00") }),
    );

    expect(result).toMatchObject({ outcome: "processed" });
  });
});
