import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ReprocessPendingReferenceUseCase } from "../../../src/application/reprocess-pending-reference/reprocess-pending-reference.use-case";
import { SubmitWagerTransactionUseCase } from "../../../src/application/submit-wager-transaction/submit-wager-transaction.use-case";
import { PENDING_REFERENCE_BASE_DELAY_MS } from "../../../src/application/wager-processing/pending-reference-policy";
import { Money } from "../../../src/domain/money/money";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../src/domain/transaction/transaction-status";
import type { Wallet } from "../../../src/domain/wallet/wallet";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { WagerTransactionSchema } from "../../../src/infrastructure/persistence/models/wager-transaction.model";
import { WalletSchema } from "../../../src/infrastructure/persistence/models/wallet.model";
import { UuidV7IdGenerator } from "../../../src/infrastructure/time/uuid-v7-id-generator";
import { drainPendingReferences } from "../../../src/interfaces/workers/pending-reference.tick";
import { FixedClock } from "../../support/fakes";
import { assertLedgerInvariant } from "../../support/ledger-invariant";
import { walletIn } from "../../support/sqs-fixture";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.dispose();
});

function input(
  wallet: Wallet,
  kind: TransactionKind,
  externalId: string,
  reference: string | null,
) {
  return {
    idempotencyKey: `provider-a:${externalId}`,
    providerId: "provider-a",
    externalTransactionId: externalId,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: "round-1",
    gameId: "game-1",
    kind,
    money: Money.from({ amount: "40.00", currency: "BRL" }),
    referenceExternalTransactionId: reference,
    context: { correlationId: "corr-worker", causationId: null },
  };
}

function statusOf(externalTransactionId: string) {
  return db.orm.em.fork().findOneOrFail(WagerTransactionSchema, { externalTransactionId });
}

describe("pending reference worker", () => {
  test("ROLLBACK first, BET later: the worker ends the ROLLBACK as PROCESSED", async () => {
    // A carteira (e seu lançamento de abertura) nasce ANTES do relógio fixo do teste; senão a
    // abertura teria created_at posterior às movimentações e o ledger sairia fora de ordem.
    const wallet = await walletIn(db, "100.00");
    const clock = new FixedClock(new Date());
    const ids = new UuidV7IdGenerator();
    const unitOfWork = new MikroOrmUnitOfWork(db.orm);
    const submit = new SubmitWagerTransactionUseCase(unitOfWork, clock, ids);
    const reprocess = new ReprocessPendingReferenceUseCase(unitOfWork, clock, ids);
    const betId = `bet-${crypto.randomUUID()}`;
    const rollbackId = `rollback-${crypto.randomUUID()}`;

    const rollback = await submit.execute(
      input(wallet, TransactionKind.ROLLBACK, rollbackId, betId),
    );
    expect(rollback.outcome).toBe("pendingReference");
    await submit.execute(input(wallet, TransactionKind.BET, betId, null));
    expect(await drainPendingReferences(reprocess, 10)).toBe(0);

    clock.advance(PENDING_REFERENCE_BASE_DELAY_MS);
    const attempted = await drainPendingReferences(reprocess, 10);

    expect(attempted).toBe(1);
    expect((await statusOf(rollbackId)).status).toBe(TransactionStatus.PROCESSED);
    expect((await statusOf(rollbackId)).referenceTransactionId).toBe((await statusOf(betId)).id);
    await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
    const stored = await db.orm.em.fork().findOneOrFail(WalletSchema, { id: wallet.id });
    expect(stored).toMatchObject({ balance: "100.00" });
  });

  test("a round stops at the batch size even with more due transactions", async () => {
    const clock = new FixedClock(new Date());
    const ids = new UuidV7IdGenerator();
    const unitOfWork = new MikroOrmUnitOfWork(db.orm);
    const submit = new SubmitWagerTransactionUseCase(unitOfWork, clock, ids);
    const wallet = await walletIn(db, "100.00");
    for (let index = 0; index < 3; index += 1) {
      const id = crypto.randomUUID();
      await submit.execute(input(wallet, TransactionKind.REFUND, id, `missing-${id}`));
    }
    clock.advance(PENDING_REFERENCE_BASE_DELAY_MS);

    const attempted = await drainPendingReferences(
      new ReprocessPendingReferenceUseCase(unitOfWork, clock, ids),
      2,
    );

    expect(attempted).toBe(2);
  });
});
