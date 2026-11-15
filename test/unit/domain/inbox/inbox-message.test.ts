import { describe, expect, test } from "bun:test";
import { InvariantViolationError } from "../../../../src/domain/errors/invariant-violation.error";
import { InboxMessage } from "../../../../src/domain/inbox/inbox-message";

const receivedAt = new Date("2026-01-01T00:00:00.000Z");
const now = new Date("2026-01-01T00:00:05.000Z");

const receive = (): InboxMessage =>
  InboxMessage.receive({
    consumerName: "wager-consumer",
    messageId: "msg-1",
    payloadHash: "abc",
    receivedAt,
  });

describe("InboxMessage", () => {
  test("matches only the payload hash it was received with", () => {
    const message = receive();
    expect(message.matchesPayload("abc")).toBe(true);
    expect(message.matchesPayload("other")).toBe(false);
  });

  test("is born unprocessed with its identity", () => {
    const message = receive();
    expect(message.isProcessed()).toBe(false);
    expect(message.processedAt).toBeNull();
    expect(message.consumerName).toBe("wager-consumer");
    expect(message.messageId).toBe("msg-1");
    expect(message.payloadHash).toBe("abc");
    expect(message.receivedAt).toEqual(receivedAt);
  });

  test("marks processed with the given time", () => {
    const message = receive();
    message.markProcessed(now);
    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt).toEqual(now);
  });

  test("rejects marking processed twice", () => {
    const message = receive();
    message.markProcessed(now);
    expect(() => message.markProcessed(now)).toThrow(InvariantViolationError);
  });

  test("rehydrates a processed message without revalidating", () => {
    const message = InboxMessage.rehydrate({
      consumerName: "wager-consumer",
      messageId: "msg-1",
      payloadHash: "abc",
      receivedAt,
      processedAt: now,
    });
    expect(message.isProcessed()).toBe(true);
    expect(() => message.markProcessed(now)).toThrow(InvariantViolationError);
  });
});
