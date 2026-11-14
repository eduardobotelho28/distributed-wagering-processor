import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { Money } from "../../../../src/domain/money/money";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import type { WagerTransaction } from "../../../../src/domain/transaction/wager-transaction";
import { WagerTransactionRepository } from "../../../../src/infrastructure/persistence/repositories/wager-transaction.repository";
import { FIXED_NOW } from "../../../support/factories";
import { createTestDatabase, type TestDatabase } from "../../../support/test-database";
import { buildWagerTransaction } from "../../../support/wager-transaction-builder";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.dispose();
});

function repository(): WagerTransactionRepository {
  return new WagerTransactionRepository(db.orm.em.fork());
}

async function insertPendingReference(
  providerId: string,
  nextAttemptAt: Date,
): Promise<WagerTransaction> {
  const transaction = buildWagerTransaction({
    kind: TransactionKind.REFUND,
    providerId,
    referenceExternalTransactionId: "missing",
  });
  transaction.markPendingReference();
  await repository().insert(transaction, {
    resultingBalance: null,
    pendingAttempts: 1,
    nextAttemptAt,
  });
  return transaction;
}

describe("WagerTransactionRepository lookups", () => {
  test("finds a transaction by id, idempotency key and provider external id", async () => {
    const transaction = buildWagerTransaction();
    await repository().insert(transaction);

    const byId = await repository().findById(transaction.id);
    const byKey = await repository().findByIdempotencyKey(transaction.idempotencyKey);
    const byExternal = await repository().findByProviderAndExternalId(
      transaction.providerId,
      transaction.externalTransactionId,
    );

    expect(byId?.money.toJSON()).toEqual({ amount: "10.00", currency: "BRL" });
    expect(byKey?.id).toBe(transaction.id);
    expect(byExternal?.id).toBe(transaction.id);
    expect(await repository().findByIdempotencyKey("unknown")).toBeNull();
    expect(
      await repository().findByProviderAndExternalId("other", transaction.externalTransactionId),
    ).toBeNull();
  });

  test("rejects a second insert with the same idempotency key", async () => {
    const transaction = buildWagerTransaction();
    await repository().insert(transaction);

    await expect(repository().insert(transaction)).rejects.toThrow();
  });
});

describe("WagerTransactionRepository update", () => {
  test("persists the lifecycle of a processed transaction", async () => {
    const transaction = buildWagerTransaction();
    await repository().insert(transaction);

    transaction.markProcessed(FIXED_NOW, null);
    await repository().update(transaction, {
      resultingBalance: Money.from({ amount: "90.00", currency: "BRL" }),
      pendingAttempts: 0,
      nextAttemptAt: null,
    });

    const saved = await repository().findById(transaction.id);
    expect(saved?.status).toBe(TransactionStatus.PROCESSED);
    expect(saved?.processedAt).toEqual(FIXED_NOW);
  });

  test("persists a rejection with its failure code", async () => {
    const transaction = buildWagerTransaction();
    await repository().insert(transaction);

    transaction.reject(FailureCode.INSUFFICIENT_FUNDS);
    await repository().update(transaction);

    const saved = await repository().findById(transaction.id);
    expect(saved?.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
  });

  test("fails when the transaction does not exist", async () => {
    await expect(repository().update(buildWagerTransaction())).rejects.toThrow();
  });
});

describe("WagerTransactionRepository reversals", () => {
  test("finds only the processed reversal of a reference", async () => {
    const bet = buildWagerTransaction();
    bet.markProcessed(FIXED_NOW, null);
    await repository().insert(bet);
    const rejected = buildWagerTransaction({
      kind: TransactionKind.ROLLBACK,
      referenceExternalTransactionId: bet.externalTransactionId,
    });
    rejected.reject(FailureCode.AMOUNT_MISMATCH);
    await repository().insert(rejected);

    expect(await repository().findProcessedReversalOf(bet.id)).toBeNull();

    const refund = buildWagerTransaction({
      kind: TransactionKind.REFUND,
      referenceExternalTransactionId: bet.externalTransactionId,
    });
    refund.markProcessed(FIXED_NOW, bet.id);
    await repository().insert(refund);

    expect((await repository().findProcessedReversalOf(bet.id))?.id).toBe(refund.id);
  });
});

describe("WagerTransactionRepository due pending references", () => {
  test("returns only due rows, oldest first, with their retry state", async () => {
    const provider = `provider-${crypto.randomUUID()}`;
    const later = await insertPendingReference(provider, new Date(FIXED_NOW.getTime() - 1_000));
    const earlier = await insertPendingReference(provider, new Date(FIXED_NOW.getTime() - 5_000));
    await insertPendingReference(provider, new Date(FIXED_NOW.getTime() + 60_000));

    const due = await db.orm.em
      .fork()
      .transactional((em) =>
        new WagerTransactionRepository(em).findDuePendingReferenceForUpdateSkipLocked(
          10,
          FIXED_NOW,
        ),
      );

    const ours = due.filter((row) => row.transaction.providerId === provider);
    expect(ours.map((row) => row.transaction.id)).toEqual([earlier.id, later.id]);
    expect(ours[0]?.state.pendingAttempts).toBe(1);
  });

  test("two concurrent workers lock disjoint rows", async () => {
    const provider = `provider-${crypto.randomUUID()}`;
    const past = new Date(FIXED_NOW.getTime() - 10_000);
    for (let index = 0; index < 4; index += 1) await insertPendingReference(provider, past);
    let release = (): void => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalLocked = (): void => {};
    const firstLocked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });

    const first = db.orm.em.fork().transactional(async (em) => {
      const rows = await new WagerTransactionRepository(
        em,
      ).findDuePendingReferenceForUpdateSkipLocked(2, FIXED_NOW);
      signalLocked();
      await hold;
      return rows.map((row) => row.transaction.id);
    });
    await firstLocked;
    const second = await db.orm.em.fork().transactional(async (em) => {
      const rows = await new WagerTransactionRepository(
        em,
      ).findDuePendingReferenceForUpdateSkipLocked(2, FIXED_NOW);
      return rows.map((row) => row.transaction.id);
    });
    release();
    const firstIds = await first;

    expect(firstIds).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(firstIds.filter((id) => second.includes(id))).toEqual([]);
  });
});
