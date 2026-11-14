import { describe, expect, test } from "bun:test";
import { InvariantViolationError } from "../../../../src/domain/errors/invariant-violation.error";
import {
  OUTBOX_BACKOFF_CAP_MS,
  OutboxMessage,
  type OutboxEvent,
} from "../../../../src/domain/outbox/outbox-message";

const occurredAt = new Date("2026-01-01T00:00:00.000Z");
const at = (ms: number): Date => new Date(occurredAt.getTime() + ms);

const event: OutboxEvent = {
  eventId: "evt-1",
  eventType: "WagerTransactionProcessed",
  aggregateId: "aggregate-1",
  occurredAt,
  toJSON: () => ({ eventId: "evt-1", data: { amount: "10.00" } }),
};

describe("OutboxMessage", () => {
  test("is enqueued pending and due at the event time", () => {
    const message = OutboxMessage.enqueue(event);
    expect(message.isPending()).toBe(true);
    expect(message.attempts).toBe(0);
    expect(message.isDue(occurredAt)).toBe(true);
    expect(message.isDue(at(-1))).toBe(false);
    expect(message.payload).toEqual({ eventId: "evt-1", data: { amount: "10.00" } });
    expect(message.aggregateId).toBe("aggregate-1");
    expect(message.occurredAt).toEqual(occurredAt);
  });

  test("doubles the retry delay on each failure", () => {
    const message = OutboxMessage.enqueue(event);
    const delays = [1_000, 2_000, 4_000, 8_000, 16_000];
    for (const delay of delays) {
      message.scheduleRetry(occurredAt);
      expect(message.nextAttemptAt).toEqual(at(delay));
    }
    expect(message.attempts).toBe(5);
  });

  test("caps the retry delay", () => {
    const message = OutboxMessage.enqueue(event);
    for (let i = 0; i < 20; i++) {
      message.scheduleRetry(occurredAt);
    }
    expect(message.nextAttemptAt).toEqual(at(OUTBOX_BACKOFF_CAP_MS));
  });

  test("is not due before the retry time", () => {
    const message = OutboxMessage.enqueue(event);
    message.scheduleRetry(occurredAt);
    expect(message.isDue(at(999))).toBe(false);
    expect(message.isDue(at(1_000))).toBe(true);
  });

  test("stops being pending or due once published", () => {
    const message = OutboxMessage.enqueue(event);
    message.markPublished(at(10));
    expect(message.isPending()).toBe(false);
    expect(message.isDue(at(10))).toBe(false);
    expect(message.publishedAt).toEqual(at(10));
  });

  test("rejects publishing or retrying an already published message", () => {
    const message = OutboxMessage.enqueue(event);
    message.markPublished(at(10));
    expect(() => message.markPublished(at(20))).toThrow(InvariantViolationError);
    expect(() => message.scheduleRetry(at(20))).toThrow(InvariantViolationError);
  });
});
