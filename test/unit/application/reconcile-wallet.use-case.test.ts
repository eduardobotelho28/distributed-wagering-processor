import { describe, expect, test } from "bun:test";
import { ReconcileWalletUseCase } from "../../../src/application/reconcile-wallet/reconcile-wallet.use-case";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import { Wallet } from "../../../src/domain/wallet/wallet";
import { RecordingLogger, RecordingMetrics } from "../../support/fakes";
import { brl, createSubmitFixture } from "../../support/submit-fixture";

async function setup() {
  const fixture = await createSubmitFixture("100.00");
  await fixture.useCase.execute(fixture.input({ money: brl("30.00") }));
  await fixture.useCase.execute(fixture.input({ kind: TransactionKind.WIN, money: brl("5.00") }));
  const logger = new RecordingLogger();
  const metrics = new RecordingMetrics();
  const useCase = new ReconcileWalletUseCase(fixture.unitOfWork, logger, metrics);
  return { fixture, logger, metrics, useCase };
}

describe("ReconcileWalletUseCase", () => {
  test("reports a consistent wallet without logging or counting", async () => {
    const { fixture, logger, metrics, useCase } = await setup();

    const result = await useCase.execute(fixture.wallet.id);

    if (result.outcome !== "reconciled") throw new Error("expected reconciled");
    const { report } = result;
    expect(report.storedBalance.toJSON()).toEqual({ amount: "75.00", currency: "BRL" });
    expect(report.calculatedBalance.toJSON()).toEqual({ amount: "75.00", currency: "BRL" });
    expect(report.difference.toJSON()).toEqual({ amount: "0.00", currency: "BRL" });
    expect(report.consistent).toBe(true);
    expect(report.checkedEntries).toBe(3);
    expect(logger.errors).toEqual([]);
    expect(metrics.counters.size).toBe(0);
  });

  test("flags a deliberately corrupted balance, logs it and counts it without fixing", async () => {
    const { fixture, logger, metrics, useCase } = await setup();
    const corrupted = Wallet.rehydrate({
      id: fixture.wallet.id,
      playerId: fixture.wallet.playerId,
      balance: brl("80.00"),
      version: fixture.wallet.version,
    });
    fixture.unitOfWork.repositories.wallets.rows.set(corrupted.id, corrupted);

    const result = await useCase.execute(fixture.wallet.id);

    if (result.outcome !== "reconciled") throw new Error("expected reconciled");
    expect(result.report.consistent).toBe(false);
    expect(result.report.difference.toJSON().amount).toBe("5.00");
    expect(logger.errors).toEqual([
      {
        message: "wallet balance diverges from ledger",
        fields: { walletId: fixture.wallet.id, difference: "5.00 BRL", checkedEntries: 3 },
      },
    ]);
    expect(metrics.counters.get("reconciliation_divergences_total")).toBe(1);
    const stored = await fixture.unitOfWork.repositories.wallets.findById(fixture.wallet.id);
    expect(stored?.balance.toJSON().amount).toBe("80.00");
  });

  test("returns walletNotFound for an unknown wallet", async () => {
    const { useCase } = await setup();

    expect(await useCase.execute("missing")).toEqual({ outcome: "walletNotFound" });
  });
});
