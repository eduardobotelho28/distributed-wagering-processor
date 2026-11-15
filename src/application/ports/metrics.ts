// DECISION: nomes e labels como uniões fechadas; um typo vira erro de compilação, não uma série
// nova no Prometheus. Os valores de label também são fechados para limitar a cardinalidade.
export interface CounterLabels {
  wager_transactions_total: {
    status:
      | "processed"
      | "rejected"
      | "pendingReference"
      | "failed"
      | "idempotencyConflict"
      | "externalIdConflict";
    channel: Channel;
  };
  duplicates_detected_total: { source: "inbox" | "idempotency_key" };
  retries_total: { kind: "sqs_message" | "outbox_publish" | "pending_reference" };
  dlq_messages_total: { code: string };
  lock_conflicts_total: { kind: "deadlock" | "lock_timeout" | "serialization" };
  reconciliation_divergences_total: Record<string, never>;
}

export interface HistogramLabels {
  wager_processing_duration_seconds: { channel: Channel };
  outbox_publish_lag_seconds: Record<string, never>;
}

export type Channel = "http" | "sqs" | "reprocess";
export type CounterName = keyof CounterLabels;
export type HistogramName = keyof HistogramLabels;

export interface Metrics {
  increment<N extends CounterName>(name: N, labels: CounterLabels[N]): void;
  observe<N extends HistogramName>(name: N, seconds: number, labels: HistogramLabels[N]): void;
}
