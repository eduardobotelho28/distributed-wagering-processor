import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OutboxMessageSchema } from "../../../src/infrastructure/persistence/models/outbox-message.model";
import { field, type HttpTestApp, startHttpApp } from "../../support/http-app";
import { createWalletOver, submitTransaction } from "../../support/http-scenario";
import { assertLedgerInvariant } from "../../support/ledger-invariant";

let app: HttpTestApp;

beforeAll(async () => {
  app = await startHttpApp();
});

afterAll(async () => {
  await app.close();
});

describe("POST /wagering/transactions", () => {
  test("201 for a processed BET with the README body, 200 on identical replay", async () => {
    const walletId = await createWalletOver(app, "1000.00");

    const first = await submitTransaction(app, walletId, {
      externalTransactionId: "transaction-123",
      amount: "25.00",
    });
    const replay = await submitTransaction(app, walletId, {
      externalTransactionId: "transaction-123",
      amount: "25.00",
    });

    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      transactionId: expect.any(String),
      status: "PROCESSED",
      balance: { amount: "975.00", currency: "BRL" },
      idempotentReplay: false,
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ ...Object(first.body), idempotentReplay: true });
    await assertLedgerInvariant(app.db.orm.em.fork(), walletId);
  });

  test("202 for a reversal whose reference has not arrived", async () => {
    const walletId = await createWalletOver(app, "100.00");

    const reply = await submitTransaction(app, walletId, {
      kind: "REFUND",
      referenceExternalTransactionId: "never-sent",
    });

    expect(reply.status).toBe(202);
    expect(reply.body).toMatchObject({ status: "PENDING_REFERENCE", balance: null });
  });

  test("422 for insufficient funds, and 422 again on replay", async () => {
    const walletId = await createWalletOver(app, "5.00");
    const overrides = { externalTransactionId: crypto.randomUUID(), amount: "50.00" };

    const first = await submitTransaction(app, walletId, overrides);
    const replay = await submitTransaction(app, walletId, overrides);

    expect(first.status).toBe(422);
    expect(first.body).toMatchObject({
      status: "REJECTED",
      code: "INSUFFICIENT_FUNDS",
      retryable: false,
      balance: { amount: "5.00", currency: "BRL" },
    });
    expect(replay.status).toBe(422);
    expect(field(replay.body, "idempotentReplay")).toBe(true);
  });

  test("409 when the same key comes with a different payload", async () => {
    const walletId = await createWalletOver(app, "100.00");
    await submitTransaction(app, walletId, { idempotencyKey: "fixed-key", amount: "1.00" });

    const reply = await submitTransaction(app, walletId, {
      idempotencyKey: "fixed-key",
      amount: "2.00",
    });

    expect(reply.status).toBe(409);
    expect(reply.body).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", retryable: false });
  });

  test.each([
    ["missing Idempotency-Key header", { idempotencyKey: null }, "IDEMPOTENCY_KEY_REQUIRED"],
    ["OPENING from outside", { kind: "OPENING" }, "OPENING_NOT_ALLOWED"],
    ["unknown kind", { kind: "JACKPOT" }, "INVALID_KIND"],
    ["three decimal places", { amount: "1.001" }, "INVALID_MONEY"],
    ["refund without reference", { kind: "REFUND" }, "REFERENCE_REQUIRED"],
  ])("400 for %s", async (_name, overrides, code) => {
    const walletId = await createWalletOver(app, "10.00");

    const reply = await submitTransaction(app, walletId, overrides);

    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ code, retryable: false });
  });

  test("propagates x-correlation-id into the outbox events", async () => {
    const walletId = await createWalletOver(app, "10.00");

    const reply = await submitTransaction(app, walletId, {
      headers: { "x-correlation-id": "corr-e2e-1" },
    });

    const messages = await app.db.orm.em
      .fork()
      .find(OutboxMessageSchema, { aggregateId: String(field(reply.body, "transactionId")) });
    expect(messages[0]?.payload).toMatchObject({ correlationId: "corr-e2e-1" });
  });

  test("README scenario: two parallel 80.00 bets on 100.00 over HTTP", async () => {
    const walletId = await createWalletOver(app, "100.00");

    const replies = await Promise.all([
      submitTransaction(app, walletId, { amount: "80.00" }),
      submitTransaction(app, walletId, { amount: "80.00" }),
    ]);

    expect(replies.map((reply) => reply.status).sort()).toEqual([201, 422]);
    const wallet = await app.request("GET", `/wallets/${walletId}`);
    expect(field(wallet.body, "balance")).toEqual({ amount: "20.00", currency: "BRL" });
    await assertLedgerInvariant(app.db.orm.em.fork(), walletId);
  });
});
