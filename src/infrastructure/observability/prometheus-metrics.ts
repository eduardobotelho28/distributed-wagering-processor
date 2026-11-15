import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";
import type {
  CounterLabels,
  CounterName,
  HistogramLabels,
  HistogramName,
  Metrics,
} from "../../application/ports/metrics";

const COUNTERS: Record<CounterName, { help: string; labelNames: string[] }> = {
  wager_transactions_total: {
    help: "Wager transactions recorded, by resulting status and entry channel",
    labelNames: ["status", "channel"],
  },
  duplicates_detected_total: {
    help: "Duplicates absorbed by the inbox or by idempotency key replay",
    labelNames: ["source"],
  },
  retries_total: { help: "Retries scheduled, by kind", labelNames: ["kind"] },
  dlq_messages_total: { help: "Messages moved to the dead-letter queue", labelNames: ["code"] },
  lock_conflicts_total: {
    help: "Lock conflicts and timeouts seen in the database",
    labelNames: ["kind"],
  },
  reconciliation_divergences_total: {
    help: "Wallets whose stored balance diverged from the ledger",
    labelNames: [],
  },
};

// DECISION: buckets de latência de 5ms a 5s; o caminho feliz fica em dezenas de ms e um lock
// disputado em centenas. Lag do outbox de 10ms a 5min, o teto do backoff de publicação.
const HISTOGRAMS: Record<HistogramName, { help: string; labelNames: string[]; buckets: number[] }> =
  {
    wager_processing_duration_seconds: {
      help: "Time to process a wager transaction, by entry channel",
      labelNames: ["channel"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    },
    outbox_publish_lag_seconds: {
      help: "Delay between an event being recorded and published",
      labelNames: [],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
    },
    wallet_lock_wait_seconds: {
      help: "Time waiting for the wallet row lock (SELECT ... FOR UPDATE)",
      labelNames: [],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10],
    },
  };

const COUNTER_NAMES: readonly CounterName[] = [
  "wager_transactions_total",
  "duplicates_detected_total",
  "retries_total",
  "dlq_messages_total",
  "lock_conflicts_total",
  "reconciliation_divergences_total",
];

const HISTOGRAM_NAMES: readonly HistogramName[] = [
  "wager_processing_duration_seconds",
  "outbox_publish_lag_seconds",
  "wallet_lock_wait_seconds",
];

// DECISION: registry próprio em vez do global do prom-client; testes criam instâncias isoladas
// e nada vaza entre suítes.
export class PrometheusMetrics implements Metrics {
  readonly registry = new Registry();
  private readonly counters = new Map<CounterName, Counter>();
  private readonly histograms = new Map<HistogramName, Histogram>();

  constructor(options: { defaultMetrics: boolean } = { defaultMetrics: true }) {
    if (options.defaultMetrics) collectDefaultMetrics({ register: this.registry });
    for (const name of COUNTER_NAMES) {
      const config = COUNTERS[name];
      this.counters.set(name, new Counter({ name, ...config, registers: [this.registry] }));
    }
    for (const name of HISTOGRAM_NAMES) {
      const config = HISTOGRAMS[name];
      this.histograms.set(name, new Histogram({ name, ...config, registers: [this.registry] }));
    }
  }

  increment<N extends CounterName>(name: N, labels: CounterLabels[N]): void {
    this.counters.get(name)?.inc(labels);
  }

  observe<N extends HistogramName>(name: N, seconds: number, labels: HistogramLabels[N]): void {
    this.histograms.get(name)?.observe(labels, seconds);
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
