// DECISION: nomes de métrica como união fechada; a implementação prom-client (T82) registra
// cada nome uma vez e um typo vira erro de compilação, não uma série nova.
export type CounterName = "reconciliation_divergences_total";

export interface Metrics {
  increment(name: CounterName): void;
}
