import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { field, type HttpTestApp, startHttpApp } from "../../support/http-app";
import { createWalletOver, submitTransaction } from "../../support/http-scenario";

let app: HttpTestApp;

beforeAll(async () => {
  app = await startHttpApp();
});

afterAll(async () => {
  await app.close();
});

describe("GET transaction endpoints", () => {
  test("finds a transaction by id and by provider + external id", async () => {
    const walletId = await createWalletOver(app, "100.00");
    const externalTransactionId = `ext-${crypto.randomUUID()}`;
    const submitted = await submitTransaction(app, walletId, { externalTransactionId });
    const transactionId = String(field(submitted.body, "transactionId"));

    const byId = await app.request("GET", `/wagering/transactions/${transactionId}`);
    const byExternal = await app.request(
      "GET",
      `/providers/provider-a/wagering/transactions/${externalTransactionId}`,
    );

    expect(byId.status).toBe(200);
    expect(byId.body).toEqual({
      id: transactionId,
      providerId: "provider-a",
      externalTransactionId,
      playerId: "player-http",
      walletId,
      roundId: "round-1",
      gameId: "fortune-test",
      kind: "BET",
      money: { amount: "10.00", currency: "BRL" },
      referenceExternalTransactionId: null,
      referenceTransactionId: null,
      status: "PROCESSED",
      failureCode: null,
      processedAt: expect.any(String),
      createdAt: expect.any(String),
    });
    expect(byExternal.status).toBe(200);
    expect(byExternal.body).toEqual(byId.body);
  });

  test("exposes the failure code of a rejected transaction", async () => {
    const walletId = await createWalletOver(app, "1.00");
    const submitted = await submitTransaction(app, walletId, { amount: "9.00" });

    const reply = await app.request(
      "GET",
      `/wagering/transactions/${String(field(submitted.body, "transactionId"))}`,
    );

    expect(reply.body).toMatchObject({ status: "REJECTED", failureCode: "INSUFFICIENT_FUNDS" });
  });

  test("returns 404 for unknown transactions", async () => {
    const byId = await app.request("GET", `/wagering/transactions/${crypto.randomUUID()}`);
    const byExternal = await app.request(
      "GET",
      "/providers/provider-a/wagering/transactions/never-sent",
    );

    expect(byId.status).toBe(404);
    expect(field(byId.body, "code")).toBe("TRANSACTION_NOT_FOUND");
    expect(byExternal.status).toBe(404);
  });

  test("returns 400 for a malformed transaction id", async () => {
    const reply = await app.request("GET", "/wagering/transactions/tx-1");

    expect(reply.status).toBe(400);
  });
});
