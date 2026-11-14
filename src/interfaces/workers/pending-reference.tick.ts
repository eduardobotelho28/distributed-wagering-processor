import type { ReprocessPendingReferenceUseCase } from "../../application/reprocess-pending-reference/reprocess-pending-reference.use-case";
import { runWithLogContext } from "../../infrastructure/observability/log-context";
import {
  recordSubmission,
  secondsSince,
  type SubmissionTelemetry,
} from "../observability/submission-telemetry";

// DECISION: uma rodada processa até `batchSize` transações devidas, uma por transação SQL
// (cada execute trava a próxima com SKIP LOCKED). Para no primeiro "idle" para não girar em
// vazio; o limite impede que uma rodada monopolize o worker com um backlog grande.
export async function drainPendingReferences(
  reprocess: ReprocessPendingReferenceUseCase,
  batchSize: number,
  telemetry: SubmissionTelemetry,
): Promise<number> {
  for (let attempted = 0; attempted < batchSize; attempted += 1) {
    const done = await runWithLogContext({}, () => attemptOne(reprocess, telemetry));
    if (done) return attempted;
  }
  return batchSize;
}

// Devolve true quando não havia nada devido.
async function attemptOne(
  reprocess: ReprocessPendingReferenceUseCase,
  telemetry: SubmissionTelemetry,
): Promise<boolean> {
  const startedAt = performance.now();
  const result = await reprocess.execute();
  if (result.outcome === "idle") return true;
  if (result.result.outcome === "pendingReference") {
    telemetry.metrics.increment("retries_total", { kind: "pending_reference" });
    telemetry.logger.info("pending reference still missing, rescheduled", {
      transactionId: result.result.transactionId,
    });
    return false;
  }
  recordSubmission(telemetry, result.result, "reprocess", secondsSince(startedAt));
  return false;
}
