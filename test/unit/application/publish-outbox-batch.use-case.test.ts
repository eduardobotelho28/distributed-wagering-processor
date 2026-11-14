import { describe, expect, test } from "bun:test";
import { PublishOutboxBatchUseCase } from "../../../src/application/publish-outbox/publish-outbox-batch.use-case";
import { OutboxMessage } from "../../../src/domain/outbox/outbox-message";
import { FIXED_NOW } from "../../support/factories";
import { FixedClock, InMemoryUnitOfWork, RecordingMessageQueue } from "../../support/fakes";

const EVENTS = "wager-events";

function enqueue(unitOfWork: InMemoryUnitOfWork, eventId: string): OutboxMessage {
  const message = OutboxMessage.enqueue({
    eventId,
    eventType: "WagerTransactionProcessed",
    aggregateId: "tx-1",
    occurredAt: FIXED_NOW,
    toJSON: () => ({ eventId, eventType: "WagerTransactionProcessed" }),
  });
  unitOfWork.repositories.outbox.messages.push(message);
  return message;
}

function setup(batchSize = 10) {
  const unitOfWork = new InMemoryUnitOfWork();
  const queue = new RecordingMessageQueue();
  const clock = new FixedClock(FIXED_NOW);
  const useCase = new PublishOutboxBatchUseCase(unitOfWork, queue, clock, {
    eventsQueue: EVENTS,
    batchSize,
  });
  return { unitOfWork, queue, clock, useCase };
}

describe("PublishOutboxBatchUseCase", () => {
  test("publishes the serialized envelope of each due event and marks it published", async () => {
    const { unitOfWork, queue, useCase } = setup();
    const first = enqueue(unitOfWork, "evt-1");
    const second = enqueue(unitOfWork, "evt-2");

    const result = await useCase.execute();

    expect(result).toEqual({ published: 2, failed: 0 });
    expect(queue.calls.map((call) => [call.queue, call.message?.body])).toEqual([
      [EVENTS, JSON.stringify({ eventId: "evt-1", eventType: "WagerTransactionProcessed" })],
      [EVENTS, JSON.stringify({ eventId: "evt-2", eventType: "WagerTransactionProcessed" })],
    ]);
    expect([first.publishedAt, second.publishedAt]).toEqual([FIXED_NOW, FIXED_NOW]);
    expect(await useCase.execute()).toEqual({ published: 0, failed: 0 });
  });

  test("a failed send schedules a retry for that event only", async () => {
    const { unitOfWork, queue, clock, useCase } = setup();
    const failing = enqueue(unitOfWork, "evt-fail");
    const healthy = enqueue(unitOfWork, "evt-ok");
    const send = queue.send.bind(queue);
    queue.send = async (name, message) => {
      if (message.body.includes("evt-fail")) throw new Error("sqs unavailable");
      return send(name, message);
    };

    const result = await useCase.execute();

    expect(result).toEqual({ published: 1, failed: 1 });
    expect(healthy.publishedAt).toEqual(FIXED_NOW);
    expect(failing.isPending()).toBe(true);
    expect(failing.attempts).toBe(1);
    expect(failing.nextAttemptAt).toEqual(new Date(FIXED_NOW.getTime() + 1_000));
    expect(failing.isDue(clock.now())).toBe(false);
  });

  test("a retried event is published once it is due again", async () => {
    const { unitOfWork, queue, clock, useCase } = setup();
    enqueue(unitOfWork, "evt-flaky");
    const send = queue.send.bind(queue);
    let failures = 1;
    queue.send = async (name, message) => {
      if (failures-- > 0) throw new Error("sqs unavailable");
      return send(name, message);
    };
    await useCase.execute();

    clock.advance(1_000);
    const result = await useCase.execute();

    expect(result).toEqual({ published: 1, failed: 0 });
  });

  test("respects the batch size", async () => {
    const { unitOfWork, useCase } = setup(2);
    for (const id of ["a", "b", "c"]) enqueue(unitOfWork, id);

    expect(await useCase.execute()).toEqual({ published: 2, failed: 0 });
    expect(await useCase.execute()).toEqual({ published: 1, failed: 0 });
  });
});
