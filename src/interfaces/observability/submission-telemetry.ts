import type { Logger } from "../../application/ports/logger";
import type { Channel, Metrics } from "../../application/ports/metrics";
import type { SubmitResult } from "../../application/ports/submit-result";
import { addToLogContext } from "../../infrastructure/observability/log-context";

export interface SubmissionTelemetry {
  metrics: Metrics;
  logger: Logger;
}

// DECISION: um único ponto registra métricas e log de uma submissão, para HTTP, SQS e
// reprocessamento contarem igual. Replay conta como duplicata, não como nova transação.
export function recordSubmission(
  telemetry: SubmissionTelemetry,
  result: SubmitResult,
  channel: Channel,
  durationSeconds: number,
): void {
  const { metrics, logger } = telemetry;
  if (result.outcome === "invalidPayload") {
    logger.warn("wager payload rejected at the boundary", { code: result.reason });
    return;
  }
  addToLogContext({ transactionId: result.transactionId });
  if (result.idempotentReplay) {
    metrics.increment("duplicates_detected_total", { source: "idempotency_key" });
  } else {
    metrics.increment("wager_transactions_total", { status: result.outcome, channel });
  }
  metrics.observe("wager_processing_duration_seconds", durationSeconds, { channel });
  logger.info("wager transaction handled", {
    outcome: result.outcome,
    durationMs: Math.round(durationSeconds * 1000),
  });
}

export function secondsSince(startedAtMs: number): number {
  return (performance.now() - startedAtMs) / 1000;
}
