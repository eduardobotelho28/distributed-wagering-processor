import { describe, expect, test } from "bun:test";
import { createSubmitFixture } from "../../../support/submit-fixture";

describe("SubmitWagerTransaction external transaction id reuse", () => {
  test("answers conflict when the same externalTransactionId arrives under another key", async () => {
    const fixture = await createSubmitFixture("100.00");
    const original = fixture.input({ externalTransactionId: "tx-1" });
    const first = await fixture.useCase.execute(original);

    const second = await fixture.useCase.execute({ ...original, idempotencyKey: "other-key" });

    expect(second).toEqual({
      outcome: "externalIdConflict",
      transactionId: first.transactionId,
      idempotentReplay: false,
    });
    expect(fixture.unitOfWork.repositories.ledger.entries).toHaveLength(2);
  });

  test("resolves a collision on the external id as conflict when the lookup missed the winner", async () => {
    const fixture = await createSubmitFixture("100.00");
    const original = fixture.input({ externalTransactionId: "tx-race" });
    const winner = await fixture.useCase.execute(original);
    const transactions = fixture.unitOfWork.repositories.transactions;
    const realLookup = transactions.findByProviderAndExternalId.bind(transactions);
    let lookups = 0;
    transactions.findByProviderAndExternalId = async (providerId, externalId) => {
      lookups += 1;
      return lookups === 1 ? null : realLookup(providerId, externalId);
    };

    const loser = await fixture.useCase.execute({ ...original, idempotencyKey: "other-key" });

    expect(loser).toEqual({
      outcome: "externalIdConflict",
      transactionId: winner.transactionId,
      idempotentReplay: false,
    });
  });

  test("keeps the replay of the original key working after a conflicting key", async () => {
    const fixture = await createSubmitFixture("100.00");
    const original = fixture.input({ externalTransactionId: "tx-2" });
    const first = await fixture.useCase.execute(original);
    await fixture.useCase.execute({ ...original, idempotencyKey: "other-key" });

    const replay = await fixture.useCase.execute(original);

    expect(replay).toEqual({ ...first, idempotentReplay: true });
  });
});
