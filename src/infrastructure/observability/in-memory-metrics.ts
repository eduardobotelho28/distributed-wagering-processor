import type { CounterName, Metrics } from "../../application/ports/metrics";

// RISK: provisório até a T82 (prom-client + /metrics). Os contadores vivem só no processo e
// somem no restart; servem para não perder a contagem enquanto não há exportação.
export class InMemoryMetrics implements Metrics {
  private readonly counters = new Map<CounterName, number>();

  increment(name: CounterName): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }
}
