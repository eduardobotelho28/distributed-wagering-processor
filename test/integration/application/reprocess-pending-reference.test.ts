import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateWalletUseCase } from "../../../src/application/create-wallet/create-wallet.use-case";
import { ReprocessPendingReferenceUseCase } from "../../../src/application/reprocess-pending-reference/reprocess-pending-reference.use-case";
import { SubmitWagerTransactionUseCase } from "../../../src/application/submit-wager-transaction/submit-wager-transaction.use-case";
import { Money } from "../../../src/domain/money/money";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../src/domain/transaction/transaction-status";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { OutboxMessageSchema } from "../../../src/infrastructure/persistence/models/outbox-message.model";
import { WagerTransactionRepository } from "../../../src/infrastructure/persistence/repositories/wager-transaction.repository";
import { UuidV7IdGenerator } from "../../../src/infrastructure/time/uuid-v7-id-generator";
import { FixedClock } from "../../support/fakes";
import { assertLedgerInvariant } from "../../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.dispose();
});

describe("ReprocessPendingReference against Postgres", () => {
  test("resolves a refund that arrived before its BET", async () => {
    const clock = new FixedClock(new Date("2026-11-14T12:00:00.000Z"));
    const ids = new UuidV7IdGenerator();
    const unitOfWork = new MikroOrmUnitOfWork(db.orm);
    const submit = new SubmitWagerTransactionUseCase(unitOfWork, clock, ids);
    const reprocess = new ReprocessPendingReferenceUseCase(unitOfWork, clock, ids);
    const created = await new CreateWalletUseCase(unitOfWork, clock, ids).execute({
      playerId: "player-reprocess",
      initialBalance: brl("100.00"),
    });
    if (created.outcome !== "created") throw new Error("expected created");
    const wallet = created.wallet;
    const base = {
      providerId: "provider-a",
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      money: brl("25.00"),
      context: { correlationId: "corr-1", causationId: null },
    };
    const refund = await submit.execute({
      ...base,
      idempotencyKey: "provider-a:refund-1",
      externalTransactionId: "refund-1",
      kind: TransactionKind.REFUND,
      referenceExternalTransactionId: "bet-1",
    });
    await submit.execute({
      ...base,
      idempotencyKey: "provider-a:bet-1",
      externalTransactionId: "bet-1",
      kind: TransactionKind.BET,
      referenceExternalTransactionId: null,
    });
    if (refund.outcome !== "pendingReference") throw new Error("expected pending refund");

    expect(await reprocess.execute()).toEqual({ outcome: "idle" });
    clock.advance(5_000);
    const result = await reprocess.execute();

    expect(result).toMatchObject({ outcome: "attempted", result: { outcome: "processed" } });
    const stored = await new WagerTransactionRepository(db.orm.em.fork()).findById(
      refund.transactionId,
    );
    expect(stored?.status).toBe(TransactionStatus.PROCESSED);
    const workerEvents = await db.orm.em
      .fork()
      .find(OutboxMessageSchema, { aggregateId: refund.transactionId });
    const processedEvent = workerEvents.find(
      (row) => row.eventType === "WagerTransactionProcessed",
    );
    expect(processedEvent?.payload).toMatchObject({
      correlationId: "corr-1",
      causationId: refund.transactionId,
    });
    await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
  });
});
