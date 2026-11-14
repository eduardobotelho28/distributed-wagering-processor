import type { ReprocessPendingReferenceUseCase } from "../../application/reprocess-pending-reference/reprocess-pending-reference.use-case";

// DECISION: uma rodada processa até `batchSize` transações devidas, uma por transação SQL
// (cada execute trava a próxima com SKIP LOCKED). Para no primeiro "idle" para não girar em
// vazio; o limite impede que uma rodada monopolize o worker com um backlog grande.
export async function drainPendingReferences(
  reprocess: ReprocessPendingReferenceUseCase,
  batchSize: number,
): Promise<number> {
  for (let attempted = 0; attempted < batchSize; attempted += 1) {
    const result = await reprocess.execute();
    if (result.outcome === "idle") return attempted;
  }
  return batchSize;
}
