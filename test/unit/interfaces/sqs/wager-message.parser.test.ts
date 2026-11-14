import { describe, expect, test } from "bun:test";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { parseWagerMessage } from "../../../../src/interfaces/sqs/wager-message.parser";

const readmeMessage = {
  messageId: "msg-123",
  type: "WagerTransactionRequested",
  occurredAt: "2026-07-29T15:00:00.000Z",
  data: {
    providerId: "provider-a",
    externalTransactionId: "transaction-123",
    idempotencyKey: "provider-a:transaction-123",
    playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    walletId: "0192f291-27dd-7d3f-8071-5f8685deef37",
    roundId: "round-987",
    gameId: "fortune-chimp",
    kind: "BET",
    money: { amount: "25.00", currency: "BRL" },
  },
};

function withData(data: Record<string, unknown>): string {
  return JSON.stringify({ ...readmeMessage, data: { ...readmeMessage.data, ...data } });
}

describe("parseWagerMessage", () => {
  test("parses the README message with the idempotency key from the message", () => {
    const parsed = parseWagerMessage(JSON.stringify(readmeMessage));

    if (!parsed.ok) throw new Error(`expected ok, got ${parsed.code}`);
    expect(parsed.message.messageId).toBe("msg-123");
    expect(parsed.message.occurredAt).toEqual(new Date("2026-07-29T15:00:00.000Z"));
    expect(parsed.message.request.idempotencyKey).toBe("provider-a:transaction-123");
    expect(parsed.message.request.kind).toBe(TransactionKind.BET);
    expect(parsed.message.request.money.toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
  });

  test.each([
    ["OPENING", withData({ kind: "OPENING" }), "OPENING_NOT_ALLOWED"],
    ["unknown kind", withData({ kind: "JACKPOT" }), "INVALID_KIND"],
    ["float money", withData({ money: { amount: 25, currency: "BRL" } }), "INVALID_MONEY"],
    [
      "missing idempotency key",
      withData({ idempotencyKey: undefined }),
      "IDEMPOTENCY_KEY_REQUIRED",
    ],
    ["non-uuid wallet", withData({ walletId: "w-1" }), "INVALID_FIELD"],
    ["malformed JSON", "{oops", "INVALID_JSON"],
    ["wrong type", JSON.stringify({ ...readmeMessage, type: "Other" }), "UNSUPPORTED_MESSAGE_TYPE"],
    [
      "bad occurredAt",
      JSON.stringify({ ...readmeMessage, occurredAt: "yesterday" }),
      "INVALID_FIELD",
    ],
    ["missing data", JSON.stringify({ ...readmeMessage, data: undefined }), "INVALID_PAYLOAD"],
    [
      "missing messageId",
      JSON.stringify({ ...readmeMessage, messageId: undefined }),
      "INVALID_FIELD",
    ],
  ])("classifies %s as permanent", (_name, body, code) => {
    const parsed = parseWagerMessage(body);

    expect(parsed).toMatchObject({ ok: false, permanent: true, code });
  });

  test("keeps the messageId of an invalid message for the DLQ", () => {
    expect(parseWagerMessage(withData({ kind: "OPENING" }))).toMatchObject({
      ok: false,
      messageId: "msg-123",
    });
    expect(parseWagerMessage("{oops")).toMatchObject({ ok: false, messageId: null });
  });

  test("does not echo field values in the reason", () => {
    const parsed = parseWagerMessage(withData({ walletId: "secret-wallet" }));

    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain("secret-wallet");
  });
});
