import { describe, expect, test } from "bun:test";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { toErrorReply } from "../../../../src/interfaces/http/errors/global-exception.filter";
import { parseCreateWalletRequest } from "../../../../src/interfaces/http/validation/create-wallet.request";
import { parseSubmitTransactionRequest } from "../../../../src/interfaces/http/validation/submit-transaction.request";

const validBody = {
  providerId: "provider-a",
  externalTransactionId: "transaction-123",
  playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  walletId: "0192F291-27DD-7D3F-8071-5F8685DEEF37",
  roundId: "round-987",
  gameId: "fortune-chimp",
  kind: "BET",
  money: { amount: "25.00", currency: "BRL" },
};
const key = "provider-a:transaction-123";

// Passa pelo filtro global para provar o status HTTP que o cliente realmente recebe.
function rejectionOf(run: () => unknown): { status: number; code: string; message: string } {
  try {
    run();
  } catch (error) {
    const reply = toErrorReply(error);
    return { status: reply.status, code: reply.body.code, message: reply.body.message };
  }
  throw new Error("expected a rejection");
}

describe("parseSubmitTransactionRequest", () => {
  test("parses the README payload into the use case input", () => {
    const input = parseSubmitTransactionRequest(validBody, key);

    expect(input.idempotencyKey).toBe(key);
    expect(input.kind).toBe(TransactionKind.BET);
    expect(input.money.toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
    expect(input.walletId).toBe("0192f291-27dd-7d3f-8071-5f8685deef37");
    expect(input.referenceExternalTransactionId).toBeNull();
  });

  test.each([[undefined], [""], ["   "], [[]]])(
    "rejects a missing Idempotency-Key header (%p)",
    (header) => {
      expect(rejectionOf(() => parseSubmitTransactionRequest(validBody, header))).toMatchObject({
        status: 400,
        code: "IDEMPOTENCY_KEY_REQUIRED",
      });
    },
  );

  test.each([
    ["number amount", { amount: 25, currency: "BRL" }],
    ["three decimals", { amount: "25.001", currency: "BRL" }],
    ["negative", { amount: "-1.00", currency: "BRL" }],
    ["scientific", { amount: "1e3", currency: "BRL" }],
    ["lowercase currency", { amount: "25.00", currency: "brl" }],
    ["missing money", undefined],
  ])("rejects invalid money: %s", (_name, money) => {
    expect(
      rejectionOf(() => parseSubmitTransactionRequest({ ...validBody, money }, key)),
    ).toMatchObject({
      status: 400,
      code: money === undefined ? "INVALID_PAYLOAD" : "INVALID_MONEY",
    });
  });

  test.each(["JACKPOT", "bet", 1, undefined])("rejects unknown kind %p", (kind) => {
    expect(
      rejectionOf(() => parseSubmitTransactionRequest({ ...validBody, kind }, key)),
    ).toMatchObject({
      status: 400,
      code: "INVALID_KIND",
    });
  });

  test("rejects OPENING coming from HTTP", () => {
    expect(
      rejectionOf(() => parseSubmitTransactionRequest({ ...validBody, kind: "OPENING" }, key)),
    ).toMatchObject({ status: 400, code: "OPENING_NOT_ALLOWED" });
  });

  test.each([
    ["non-uuid walletId", { walletId: "wallet-1" }],
    ["blank providerId", { providerId: " " }],
    ["oversized roundId", { roundId: "r".repeat(256) }],
    ["numeric gameId", { gameId: 7 }],
  ])("rejects %s with INVALID_FIELD", (_name, override) => {
    expect(
      rejectionOf(() => parseSubmitTransactionRequest({ ...validBody, ...override }, key)),
    ).toMatchObject({
      status: 400,
      code: "INVALID_FIELD",
    });
  });

  test("does not echo the received value in the message", () => {
    const rejection = rejectionOf(() =>
      parseSubmitTransactionRequest({ ...validBody, walletId: "secret-value" }, key),
    );

    expect(rejection.message).not.toContain("secret-value");
  });

  test.each([null, "text", [1]])("rejects a non-object body %p", (body) => {
    expect(rejectionOf(() => parseSubmitTransactionRequest(body, key)).code).toBe(
      "INVALID_PAYLOAD",
    );
  });

  test("accepts a reversal with its reference", () => {
    const input = parseSubmitTransactionRequest(
      { ...validBody, kind: "REFUND", referenceExternalTransactionId: "transaction-100" },
      key,
    );

    expect(input.kind).toBe(TransactionKind.REFUND);
    expect(input.referenceExternalTransactionId).toBe("transaction-100");
  });
});

describe("parseCreateWalletRequest", () => {
  test("parses the README payload", () => {
    const input = parseCreateWalletRequest({
      playerId: "player-1",
      initialBalance: { amount: "1000.00", currency: "BRL" },
    });

    expect(input.initialBalance.toJSON()).toEqual({ amount: "1000.00", currency: "BRL" });
  });

  test("rejects a float initial balance", () => {
    expect(
      rejectionOf(() =>
        parseCreateWalletRequest({
          playerId: "p",
          initialBalance: { amount: 10.5, currency: "BRL" },
        }),
      ).code,
    ).toBe("INVALID_MONEY");
  });
});
