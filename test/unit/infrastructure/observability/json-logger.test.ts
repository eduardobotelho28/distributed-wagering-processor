import { describe, expect, test } from "bun:test";
import { JsonLogger } from "../../../../src/infrastructure/observability/json-logger";
import {
  addToLogContext,
  runWithLogContext,
} from "../../../../src/infrastructure/observability/log-context";

const NOW = new Date("2026-11-14T12:00:00.000Z");

function capture(): { logger: JsonLogger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger = new JsonLogger(
    (line) => lines.push(JSON.parse(line)),
    () => NOW,
  );
  return { logger, lines };
}

describe("JsonLogger", () => {
  test("writes one JSON line with level, message, timestamp and fields", () => {
    const { logger, lines } = capture();

    logger.info("transaction processed", { outcome: "processed", durationMs: 12 });

    expect(lines).toEqual([
      {
        level: "info",
        message: "transaction processed",
        timestamp: "2026-11-14T12:00:00.000Z",
        outcome: "processed",
        durationMs: 12,
      },
    ]);
  });

  test("attaches the async context ids to every log inside the flow", async () => {
    const { logger, lines } = capture();

    await runWithLogContext({ correlationId: "corr-1", messageId: "msg-1" }, async () => {
      await Promise.resolve();
      addToLogContext({ transactionId: "tx-1", walletId: "w-1", providerId: "provider-a" });
      logger.warn("retrying");
    });
    logger.error("outside");

    expect(lines[0]).toMatchObject({
      level: "warn",
      correlationId: "corr-1",
      messageId: "msg-1",
      transactionId: "tx-1",
      walletId: "w-1",
      providerId: "provider-a",
    });
    expect(lines[1]).not.toHaveProperty("correlationId");
  });

  test("drops fields outside the allowlist and never logs payloads or amounts", () => {
    const { logger, lines } = capture();
    const payload = JSON.stringify({ money: { amount: "25.00", currency: "BRL" } });

    logger.info("received", {
      messageId: "msg-1",
      body: payload,
      amount: "25.00",
      balance: "975.00",
    });

    expect(lines[0]).toEqual({
      level: "info",
      message: "received",
      timestamp: "2026-11-14T12:00:00.000Z",
      messageId: "msg-1",
      redactedFields: 3,
    });
    expect(JSON.stringify(lines[0])).not.toContain("25.00");
    expect(JSON.stringify(lines[0])).not.toContain("975.00");
  });

  test("clips long values", () => {
    const { logger, lines } = capture();

    logger.info("long", { error: "x".repeat(500) });

    expect(String(lines[0]?.error).length).toBeLessThanOrEqual(129);
  });
});
