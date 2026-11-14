import { describe, expect, test } from "bun:test";
import { createSubmitFixture } from "../../../support/submit-fixture";

// Simula a corrida: a busca pela key não enxerga a vencedora (ainda não commitada) e o
// insert colide no UNIQUE. O caminho real é provado contra Postgres no teste de integração.
describe("SubmitWagerTransaction idempotency key race", () => {
  test("resolves a key collision as conflict when the payload differs", async () => {
    const fixture = await createSubmitFixture("100.00");
    const input = fixture.input();
    const winner = await fixture.useCase.execute(input);
    const transactions = fixture.unitOfWork.repositories.transactions;
    const realLookup = transactions.findByIdempotencyKey.bind(transactions);
    let lookups = 0;
    transactions.findByIdempotencyKey = async (key) => {
      lookups += 1;
      return lookups === 1 ? null : realLookup(key);
    };

    const loser = await fixture.useCase.execute({ ...input, walletId: "another-wallet" });

    expect(loser).toEqual({
      outcome: "idempotencyConflict",
      transactionId: winner.transactionId,
      idempotentReplay: false,
    });
  });

  test("resolves a key collision as replay when the payload is identical", async () => {
    const fixture = await createSubmitFixture("100.00");
    const input = fixture.input();
    const winner = await fixture.useCase.execute(input);
    const transactions = fixture.unitOfWork.repositories.transactions;
    const realLookup = transactions.findByIdempotencyKey.bind(transactions);
    let lookups = 0;
    transactions.findByIdempotencyKey = async (key) => {
      lookups += 1;
      return lookups === 1 ? null : realLookup(key);
    };

    const replay = await fixture.useCase.execute(input);

    expect(replay).toEqual({ ...winner, idempotentReplay: true });
  });
});
