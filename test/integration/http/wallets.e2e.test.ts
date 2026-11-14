import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { field, type HttpTestApp, startHttpApp } from "../../support/http-app";
import { assertLedgerInvariant } from "../../support/ledger-invariant";

let app: HttpTestApp;

beforeAll(async () => {
  app = await startHttpApp();
});

afterAll(async () => {
  await app.close();
});

function createWallet(playerId: string, amount = "1000.00") {
  return app.request("POST", "/wallets", {
    body: { playerId, initialBalance: { amount, currency: "BRL" } },
  });
}

describe("POST /wallets", () => {
  test("creates a wallet with the README body and a consistent ledger", async () => {
    const reply = await createWallet("player-e2e-1");

    expect(reply.status).toBe(201);
    expect(reply.body).toEqual({
      id: expect.any(String),
      playerId: "player-e2e-1",
      balance: { amount: "1000.00", currency: "BRL" },
      version: 1,
    });
    const walletId = field(reply.body, "id");
    if (typeof walletId !== "string") throw new Error("expected id");
    await assertLedgerInvariant(app.db.orm.em.fork(), walletId);
  });

  test("returns 409 for a duplicate player and currency", async () => {
    await createWallet("player-e2e-dup");

    const reply = await createWallet("player-e2e-dup", "5.00");

    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({
      code: "WALLET_ALREADY_EXISTS",
      message: "a wallet already exists for this player and currency",
      retryable: false,
    });
  });

  test("returns 400 for a float initial balance", async () => {
    const reply = await app.request("POST", "/wallets", {
      body: { playerId: "p", initialBalance: { amount: 10.5, currency: "BRL" } },
    });

    expect(reply.status).toBe(400);
    expect(field(reply.body, "code")).toBe("INVALID_MONEY");
  });

  test("returns 400 for malformed JSON", async () => {
    const reply = await app.request("POST", "/wallets", { rawBody: "{not json" });

    expect(reply.status).toBe(400);
    expect(field(reply.body, "code")).toBe("INVALID_PAYLOAD");
  });
});

describe("GET /wallets/:walletId", () => {
  test("returns the wallet", async () => {
    const created = await createWallet("player-e2e-get", "12.34");

    const reply = await app.request("GET", `/wallets/${String(field(created.body, "id"))}`);

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(created.body);
  });

  test("returns 404 for an unknown id", async () => {
    const reply = await app.request("GET", `/wallets/${crypto.randomUUID()}`);

    expect(reply.status).toBe(404);
    expect(reply.body).toEqual({
      code: "WALLET_NOT_FOUND",
      message: "wallet not found",
      retryable: false,
    });
  });

  test("returns 400 for a malformed id", async () => {
    const reply = await app.request("GET", "/wallets/not-a-uuid");

    expect(reply.status).toBe(400);
    expect(field(reply.body, "code")).toBe("INVALID_FIELD");
  });

  test("returns 404 NOT_FOUND for an unknown route", async () => {
    const reply = await app.request("GET", "/nope");

    expect(reply.status).toBe(404);
    expect(field(reply.body, "code")).toBe("NOT_FOUND");
  });
});
