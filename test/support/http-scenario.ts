import { field, type HttpReply, type HttpTestApp } from "./http-app";

export async function createWalletOver(app: HttpTestApp, amount: string): Promise<string> {
  const reply = await app.request("POST", "/wallets", {
    body: {
      playerId: `player-${crypto.randomUUID()}`,
      initialBalance: { amount, currency: "BRL" },
    },
  });
  const id = field(reply.body, "id");
  if (reply.status !== 201 || typeof id !== "string") throw new Error("wallet not created");
  return id;
}

export interface TransactionOverrides {
  kind?: string;
  amount?: string;
  externalTransactionId?: string;
  referenceExternalTransactionId?: string;
  idempotencyKey?: string | null;
  headers?: Record<string, string>;
}

export function submitTransaction(
  app: HttpTestApp,
  walletId: string,
  overrides: TransactionOverrides = {},
): Promise<HttpReply> {
  const externalTransactionId = overrides.externalTransactionId ?? crypto.randomUUID();
  const key =
    overrides.idempotencyKey === undefined
      ? `provider-a:${externalTransactionId}`
      : overrides.idempotencyKey;
  return app.request("POST", "/wagering/transactions", {
    headers: { ...(key === null ? {} : { "idempotency-key": key }), ...overrides.headers },
    body: {
      providerId: "provider-a",
      externalTransactionId,
      playerId: "player-http",
      walletId,
      roundId: "round-1",
      gameId: "fortune-test",
      kind: overrides.kind ?? "BET",
      money: { amount: overrides.amount ?? "10.00", currency: "BRL" },
      referenceExternalTransactionId: overrides.referenceExternalTransactionId,
    },
  });
}
