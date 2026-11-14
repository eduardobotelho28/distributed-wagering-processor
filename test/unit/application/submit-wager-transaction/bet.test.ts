import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import { LedgerDirection } from "../../../../src/domain/wallet/wallet-ledger-entry";
import { brl, createSubmitFixture } from "../../../support/submit-fixture";

describe("SubmitWagerTransaction BET", () => {
  test("debits the wallet, writes a DEBIT entry and stores the resulting balance", async () => {
    const fixture = await createSubmitFixture("100.00");

    const result = await fixture.useCase.execute(fixture.input({ money: brl("25.00") }));

    if (result.outcome !== "processed") throw new Error("expected processed");
    expect(result.balance.toJSON().amount).toBe("75.00");
    const stored = fixture.unitOfWork.repositories.transactions.rows.get(result.transactionId);
    expect(stored?.transaction.status).toBe(TransactionStatus.PROCESSED);
    expect(stored?.state.resultingBalance?.toJSON().amount).toBe("75.00");
    const last = fixture.unitOfWork.repositories.ledger.entries.at(-1);
    expect(last?.direction).toBe(LedgerDirection.DEBIT);
    expect(last?.balanceAfter.toJSON().amount).toBe("75.00");
  });

  test("debits the whole balance down to zero", async () => {
    const fixture = await createSubmitFixture("10.00");

    const result = await fixture.useCase.execute(fixture.input({ money: brl("10.00") }));

    expect(result).toMatchObject({ outcome: "processed" });
    expect(fixture.wallet.balance.toJSON().amount).toBe("0.00");
  });

  test("rejects with INSUFFICIENT_FUNDS without ledger or balance change", async () => {
    const fixture = await createSubmitFixture("10.00");

    const result = await fixture.useCase.execute(fixture.input({ money: brl("10.01") }));

    expect(result).toMatchObject({
      outcome: "rejected",
      failureCode: FailureCode.INSUFFICIENT_FUNDS,
    });
    if (result.outcome !== "rejected") throw new Error("expected rejected");
    expect(result.balance?.toJSON().amount).toBe("10.00");
    expect(fixture.unitOfWork.repositories.ledger.entries).toHaveLength(1);
    expect(fixture.wallet.balance.toJSON().amount).toBe("10.00");
    expect(fixture.wallet.version).toBe(1);
    const stored = fixture.unitOfWork.repositories.transactions.rows.get(result.transactionId);
    expect(stored?.transaction.status).toBe(TransactionStatus.REJECTED);
  });
});
