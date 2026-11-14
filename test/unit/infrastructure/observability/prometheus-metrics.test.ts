import { describe, expect, test } from "bun:test";
import { PrometheusMetrics } from "../../../../src/infrastructure/observability/prometheus-metrics";

function metrics(): PrometheusMetrics {
  return new PrometheusMetrics({ defaultMetrics: false });
}

describe("PrometheusMetrics", () => {
  test("increments every required counter with its labels", async () => {
    const registry = metrics();

    registry.increment("wager_transactions_total", { status: "processed", channel: "http" });
    registry.increment("duplicates_detected_total", { source: "inbox" });
    registry.increment("retries_total", { kind: "sqs_message" });
    registry.increment("dlq_messages_total", { code: "INVALID_JSON" });
    registry.increment("lock_conflicts_total", { kind: "lock_timeout" });
    registry.increment("reconciliation_divergences_total", {});
    const text = await registry.render();

    expect(text).toContain('wager_transactions_total{status="processed",channel="http"} 1');
    expect(text).toContain('duplicates_detected_total{source="inbox"} 1');
    expect(text).toContain('retries_total{kind="sqs_message"} 1');
    expect(text).toContain('dlq_messages_total{code="INVALID_JSON"} 1');
    expect(text).toContain('lock_conflicts_total{kind="lock_timeout"} 1');
    expect(text).toContain("reconciliation_divergences_total 1");
  });

  test("observes processing latency and outbox lag histograms", async () => {
    const registry = metrics();

    registry.observe("wager_processing_duration_seconds", 0.02, { channel: "sqs" });
    registry.observe("outbox_publish_lag_seconds", 3, {});
    const text = await registry.render();

    expect(text).toContain('wager_processing_duration_seconds_count{channel="sqs"} 1');
    expect(text).toContain('wager_processing_duration_seconds_bucket{le="0.025",channel="sqs"} 1');
    expect(text).toContain("outbox_publish_lag_seconds_count 1");
    expect(text).toContain('outbox_publish_lag_seconds_bucket{le="1"} 0');
  });

  test("instances do not share counters", async () => {
    const first = metrics();
    const second = metrics();

    first.increment("retries_total", { kind: "outbox_publish" });

    expect(await second.render()).not.toContain('retries_total{kind="outbox_publish"} 1');
  });
});
