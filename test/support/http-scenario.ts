import { field, type HttpReply, type HttpTestApp } from "./http-app";

// A transação precisa vir com o playerId dono da carteira (senão é PLAYER_MISMATCH).
// Carteira desconhecida (ex.: teste de WALLET_NOT_FOUND) recebe um jogador qualquer.
const owners = new Map<string, string>();

export function ownerOf(walletId: string): string {
  return owners.get(walletId) ?? "player-without-wallet";
}

export async function createWalletOver(app: HttpTestApp, amount: string): Promise<string> {
  const playerId = `player-${crypto.randomUUID()}`;
  const reply = await app.request("POST", "/wallets", {
    body: {
      playerId,
      initialBalance: { amount, currency: "BRL" },
    },
  });
  const id = field(reply.body, "id");
  if (reply.status !== 201 || typeof id !== "string") throw new Error("wallet not created");
  owners.set(id, playerId);
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
      playerId: ownerOf(walletId),
      walletId,
      roundId: "round-1",
      gameId: "fortune-test",
      kind: overrides.kind ?? "BET",
      money: { amount: overrides.amount ?? "10.00", currency: "BRL" },
      referenceExternalTransactionId: overrides.referenceExternalTransactionId,
    },
  });
}
