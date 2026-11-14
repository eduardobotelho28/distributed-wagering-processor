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

async function walletWithEntries(movements: number): Promise<string> {
  const walletId = await createWalletOver(app, "1000.00");
  for (let index = 0; index < movements; index += 1) {
    await submitTransaction(app, walletId, {
      kind: index % 2 === 0 ? "BET" : "WIN",
      amount: "1.00",
    });
  }
  return walletId;
}

function entryIds(body: unknown): string[] {
  const entries = field(body, "entries");
  if (!Array.isArray(entries)) throw new Error("entries missing");
  return entries.map((entry) => String(field(entry, "id")));
}

describe("GET /wallets/:walletId/ledger", () => {
  test("pages with an opaque cursor without duplicates or gaps", async () => {
    const walletId = await walletWithEntries(11);
    const pages: string[][] = [];
    let cursor: unknown = null;

    do {
      const query = cursor === null ? "?limit=5" : `?limit=5&cursor=${String(cursor)}`;
      const reply = await app.request("GET", `/wallets/${walletId}/ledger${query}`);
      expect(reply.status).toBe(200);
      pages.push(entryIds(reply.body));
      cursor = field(reply.body, "nextCursor");
    } while (cursor !== null);

    expect(pages.map((page) => page.length)).toEqual([5, 5, 2]);
    expect(new Set(pages.flat()).size).toBe(12);
  });

  test("defaults to 50 entries and describes each entry", async () => {
    const walletId = await walletWithEntries(1);

    const reply = await app.request("GET", `/wallets/${walletId}/ledger`);

    const entries = field(reply.body, "entries");
    expect(Array.isArray(entries) && entries.length).toBe(2);
    expect(Array.isArray(entries) ? entries[1] : null).toMatchObject({
      direction: "DEBIT",
      amount: { amount: "1.00", currency: "BRL" },
      balanceBefore: { amount: "1000.00", currency: "BRL" },
      balanceAfter: { amount: "999.00", currency: "BRL" },
    });
    expect(field(reply.body, "nextCursor")).toBeNull();
  });

  test.each([
    ["an invalid cursor", "?cursor=garbage", "INVALID_CURSOR"],
    ["limit above 200", "?limit=201", "INVALID_LIMIT"],
    ["limit zero", "?limit=0", "INVALID_LIMIT"],
    ["non-numeric limit", "?limit=ten", "INVALID_LIMIT"],
  ])("returns 400 for %s", async (_name, query, code) => {
    const walletId = await walletWithEntries(0);

    const reply = await app.request("GET", `/wallets/${walletId}/ledger${query}`);

    expect(reply.status).toBe(400);
    expect(field(reply.body, "code")).toBe(code);
  });

  test("accepts the maximum limit of 200", async () => {
    const walletId = await walletWithEntries(0);

    const reply = await app.request("GET", `/wallets/${walletId}/ledger?limit=200`);

    expect(reply.status).toBe(200);
  });

  test("returns 404 for an unknown wallet", async () => {
    const reply = await app.request("GET", `/wallets/${crypto.randomUUID()}/ledger`);

    expect(reply.status).toBe(404);
  });
});
