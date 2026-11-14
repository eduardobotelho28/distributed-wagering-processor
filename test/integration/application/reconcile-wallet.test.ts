import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ReconcileWalletUseCase } from "../../../src/application/reconcile-wallet/reconcile-wallet.use-case";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { WalletSchema } from "../../../src/infrastructure/persistence/models/wallet.model";
import { recordMovement, seedWallet } from "../../support/factories";
import { RecordingLogger, RecordingMetrics } from "../../support/fakes";
import { assertLedgerInvariant, LedgerInvariantError } from "../../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.dispose();
});

describe("ReconcileWallet against Postgres", () => {
  test("is consistent for a healthy wallet and flags a corrupted balance", async () => {
    const em = db.orm.em.fork();
    const wallet = await seedWallet(em, { balance: "975.00" });
    await recordMovement(em, wallet, { kind: TransactionKind.BET, amount: "25.00" });
    const logger = new RecordingLogger();
    const metrics = new RecordingMetrics();
    const useCase = new ReconcileWalletUseCase(new MikroOrmUnitOfWork(db.orm), logger, metrics);

    const healthy = await useCase.execute(wallet.id);
    await assertLedgerInvariant(em, wallet.id);
    await em.nativeUpdate(WalletSchema, { id: wallet.id }, { balance: "1000.00" });
    const corrupted = await useCase.execute(wallet.id);

    expect(healthy).toMatchObject({
      outcome: "reconciled",
      report: { consistent: true, checkedEntries: 2 },
    });
    if (corrupted.outcome !== "reconciled") throw new Error("expected reconciled");
    expect(corrupted.report.consistent).toBe(false);
    expect(corrupted.report.storedBalance.toJSON().amount).toBe("1000.00");
    expect(corrupted.report.calculatedBalance.toJSON().amount).toBe("950.00");
    expect(corrupted.report.difference.toJSON().amount).toBe("50.00");
    expect(metrics.counters.get("reconciliation_divergences_total")).toBe(1);
    expect(logger.errors).toHaveLength(1);
    await expect(assertLedgerInvariant(em, wallet.id)).rejects.toThrow(LedgerInvariantError);
  });
});
