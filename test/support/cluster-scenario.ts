import { field } from "./http-app";
import { type ClusterInstance, getJson, type HttpResult, postJson } from "./cluster";

export async function createWallet(instance: ClusterInstance, amount: string): Promise<string> {
  const reply = await postJson(instance, "/wallets", {
    playerId: `player-${crypto.randomUUID()}`,
    initialBalance: { amount, currency: "BRL" },
  });
  const id = field(reply.body, "id");
  if (reply.status !== 201 || typeof id !== "string") throw new Error("wallet not created");
  return id;
}

export interface BetRequest {
  walletId: string;
  externalTransactionId: string;
  amount: string;
}

export function bet(instance: ClusterInstance, request: BetRequest): Promise<HttpResult> {
  return postJson(
    instance,
    "/wagering/transactions",
    {
      providerId: "provider-a",
      externalTransactionId: request.externalTransactionId,
      playerId: "player-cluster",
      walletId: request.walletId,
      roundId: "round-1",
      gameId: "game-1",
      kind: "BET",
      money: { amount: request.amount, currency: "BRL" },
    },
    { "idempotency-key": `provider-a:${request.externalTransactionId}` },
  );
}

export async function balanceOf(instance: ClusterInstance, walletId: string): Promise<unknown> {
  return field((await getJson(instance, `/wallets/${walletId}`)).body, "balance");
}

export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}
