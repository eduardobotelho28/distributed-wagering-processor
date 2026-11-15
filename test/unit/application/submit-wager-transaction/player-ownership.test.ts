import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import { brl, createSubmitFixture } from "../../../support/submit-fixture";

describe("SubmitWagerTransaction player ownership", () => {
  test.each([TransactionKind.BET, TransactionKind.WIN, TransactionKind.LOSS])(
    "rejects a %s whose playerId is not the wallet owner, without touching the balance",
    async (kind) => {
      const fixture = await createSubmitFixture("100.00");
      const entriesBefore = fixture.unitOfWork.repositories.ledger.entries.length;

      const result = await fixture.useCase.execute(
        fixture.input({ kind, playerId: "someone-else", money: brl("10.00") }),
      );

      expect(result).toMatchObject({
        outcome: "rejected",
        failureCode: FailureCode.PLAYER_MISMATCH,
        idempotentReplay: false,
      });
      expect(fixture.wallet.balance.toJSON().amount).toBe("100.00");
      expect(fixture.unitOfWork.repositories.ledger.entries).toHaveLength(entriesBefore);
      const stored = fixture.unitOfWork.repositories.transactions.rows.get(result.transactionId);
      expect(stored?.transaction.status).toBe(TransactionStatus.REJECTED);
    },
  );

  test("replays a PLAYER_MISMATCH rejection with the same answer", async () => {
    const fixture = await createSubmitFixture("100.00");
    const input = fixture.input({ playerId: "someone-else" });
    const first = await fixture.useCase.execute(input);

    const replay = await fixture.useCase.execute(input);

    expect(replay).toEqual({ ...first, idempotentReplay: true });
  });
});
