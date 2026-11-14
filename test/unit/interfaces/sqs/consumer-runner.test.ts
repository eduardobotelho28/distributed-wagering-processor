import { describe, expect, test } from "bun:test";
import { ConsumerRunner } from "../../../../src/interfaces/sqs/consumer-runner";
import { createConsumerFixture, QUEUE } from "../../../support/consumer-fixture";
import { RecordingLogger } from "../../../support/fakes";

describe("pollOnce with a stop request", () => {
  test("finishes the current message and releases the unstarted ones", async () => {
    const fixture = await createConsumerFixture("100.00");
    const batch = [fixture.message(), fixture.message(), fixture.message()];
    fixture.queue.pending.push(...batch);
    let handled = 0;
    const handle = fixture.consumer.handle.bind(fixture.consumer);
    fixture.consumer.handle = async (message) => {
      handled += 1;
      return handle(message);
    };

    const processed = await fixture.consumer.pollOnce(10, 0, () => handled >= 1);

    expect(processed).toBe(1);
    expect(fixture.queue.calls).toEqual([
      { action: "ack", queue: QUEUE, receiptHandle: batch[0]?.receiptHandle },
      {
        action: "changeVisibility",
        queue: QUEUE,
        receiptHandle: batch[1]?.receiptHandle,
        timeoutSeconds: 0,
      },
      {
        action: "changeVisibility",
        queue: QUEUE,
        receiptHandle: batch[2]?.receiptHandle,
        timeoutSeconds: 0,
      },
    ]);
    expect(fixture.submit.wallet.balance.toJSON().amount).toBe("90.00");
  });
});

describe("ConsumerRunner", () => {
  test("stop waits for the in-flight message before resolving", async () => {
    const fixture = await createConsumerFixture("100.00");
    fixture.queue.pending.push(fixture.message());
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = (): void => {};
    const inFlight = new Promise<void>((resolve) => {
      started = resolve;
    });
    const handle = fixture.consumer.handle.bind(fixture.consumer);
    fixture.consumer.handle = async (message) => {
      started();
      await gate;
      return handle(message);
    };
    const runner = new ConsumerRunner(
      fixture.consumer,
      { maxMessages: 10, waitTimeSeconds: 0, errorBackoffMs: 1 },
      new RecordingLogger(),
    );

    runner.start();
    await inFlight;
    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });
    await Bun.sleep(50);
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect(fixture.queue.calls.map((call) => call.action)).toEqual(["ack"]);
  });
});
