import type { Money } from "../../domain/money/money";
import type { Logger } from "../ports/logger";
import type { Metrics } from "../ports/metrics";
import type { UnitOfWork } from "../ports/unit-of-work";

export interface ReconciliationReport {
  walletId: string;
  storedBalance: Money;
  calculatedBalance: Money;
  difference: Money;
  consistent: boolean;
  checkedEntries: number;
}

export type ReconcileWalletResult =
  { outcome: "reconciled"; report: ReconciliationReport } | { outcome: "walletNotFound" };

export class ReconcileWalletUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
  ) {}

  // DECISION: lê saldo e ledger com a carteira travada. Sem o lock, em READ COMMITTED as
  // duas leituras poderiam ver commits diferentes e acusar uma divergência que não existe.
  // INVARIANT: nunca corrige o saldo; divergência só é reportada, logada e contada.
  async execute(walletId: string): Promise<ReconcileWalletResult> {
    const report = await this.unitOfWork.run(async (repositories) => {
      const wallet = await repositories.wallets.findByIdForUpdate(walletId);
      if (wallet === null) return null;
      const summary = await repositories.ledger.summarizeByWallet(wallet.id, wallet.currency);
      const calculatedBalance = summary.credits.subtract(summary.debits);
      const difference = wallet.balance.subtract(calculatedBalance);
      return {
        walletId: wallet.id,
        storedBalance: wallet.balance,
        calculatedBalance,
        difference,
        consistent: difference.isZero(),
        checkedEntries: summary.entryCount,
      };
    });
    if (report === null) return { outcome: "walletNotFound" };
    if (!report.consistent) this.reportDivergence(report);
    return { outcome: "reconciled", report };
  }

  // DECISION: loga só id, diferença e contagem; saldo armazenado e calculado ficam na resposta.
  private reportDivergence(report: ReconciliationReport): void {
    this.logger.error("wallet balance diverges from ledger", {
      walletId: report.walletId,
      difference: report.difference.toString(),
      checkedEntries: report.checkedEntries,
    });
    this.metrics.increment("reconciliation_divergences_total", {});
  }
}
