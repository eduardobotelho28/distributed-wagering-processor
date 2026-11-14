import { describe, expect, test } from "bun:test";
import { IntervalWorker } from "../../../../src/interfaces/workers/interval-worker";
import { RecordingLogger } from "../../../support/fakes";

describe("IntervalWorker", () => {
  test("never overlaps ticks inside one process", async () => {
    let running = 0;
    let maxConcurrent = 0;
    let ticks = 0;
    const worker = new IntervalWorker(
      async () => {
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        await Bun.sleep(20);
        ticks += 1;
        running -= 1;
      },
      { name: "slow", intervalMs: 1 },
      new RecordingLogger(),
    );

    worker.start();
    await Bun.sleep(150);
    await worker.stop();

    expect(ticks).toBeGreaterThan(1);
    expect(maxConcurrent).toBe(1);
  });

  test("keeps running after a failing tick and logs it", async () => {
    const logger = new RecordingLogger();
    let calls = 0;
    const worker = new IntervalWorker(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
      },
      { name: "flaky", intervalMs: 1 },
      logger,
    );

    worker.start();
    await Bun.sleep(50);
    await worker.stop();

    expect(calls).toBeGreaterThan(1);
    expect(logger.errors[0]).toEqual({
      message: "background worker tick failed",
      fields: { worker: "flaky", error: "Error" },
    });
  });

  test("stop interrupts the wait and resolves without another tick", async () => {
    let calls = 0;
    const worker = new IntervalWorker(
      async () => {
        calls += 1;
      },
      { name: "idle", intervalMs: 60_000 },
      new RecordingLogger(),
    );

    worker.start();
    await Bun.sleep(10);
    const started = Date.now();
    await worker.stop();

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(calls).toBe(1);
  });
});
