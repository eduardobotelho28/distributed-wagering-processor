import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { WalletSchema } from "../../../src/infrastructure/persistence/models/wallet.model";
import { type HttpTestApp, startHttpApp } from "../../support/http-app";
import { createWalletOver, submitTransaction } from "../../support/http-scenario";

let app: HttpTestApp;

beforeAll(async () => {
  app = await startHttpApp();
});

afterAll(async () => {
  await app.close();
});

describe("POST /wallets/:walletId/reconciliation", () => {
  test("returns the README shape for a consistent wallet", async () => {
    const walletId = await createWalletOver(app, "1000.00");
    await submitTransaction(app, walletId, { amount: "25.00" });

    const reply = await app.request("POST", `/wallets/${walletId}/reconciliation`);

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      walletId,
      storedBalance: { amount: "975.00", currency: "BRL" },
      calculatedBalance: { amount: "975.00", currency: "BRL" },
      difference: { amount: "0.00", currency: "BRL" },
      consistent: true,
      checkedEntries: 2,
    });
  });

  test("flags a corrupted balance without fixing it", async () => {
    const walletId = await createWalletOver(app, "100.00");
    await app.db.orm.em.fork().nativeUpdate(WalletSchema, { id: walletId }, { balance: "90.00" });

    const reply = await app.request("POST", `/wallets/${walletId}/reconciliation`);
    const after = await app.request("GET", `/wallets/${walletId}`);

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      storedBalance: { amount: "90.00", currency: "BRL" },
      calculatedBalance: { amount: "100.00", currency: "BRL" },
      difference: { amount: "-10.00", currency: "BRL" },
      consistent: false,
    });
    expect(after.body).toMatchObject({ balance: { amount: "90.00", currency: "BRL" } });
  });

  test("returns 404 for an unknown wallet", async () => {
    const reply = await app.request("POST", `/wallets/${crypto.randomUUID()}/reconciliation`);

    expect(reply.status).toBe(404);
  });
});
