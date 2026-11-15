import { field } from "./http-app";
import { type ClusterInstance, getJson, type HttpResult, postJson } from "./cluster";

// A transação precisa vir com o playerId dono da carteira (senão é PLAYER_MISMATCH).
// Carteira desconhecida (ex.: teste de WALLET_NOT_FOUND) recebe um jogador qualquer.
const owners = new Map<string, string>();

export function ownerOf(walletId: string): string {
  return owners.get(walletId) ?? "player-without-wallet";
}

export async function createWallet(instance: ClusterInstance, amount: string): Promise<string> {
  const playerId = `player-${crypto.randomUUID()}`;
  const reply = await postJson(instance, "/wallets", {
    playerId,
    initialBalance: { amount, currency: "BRL" },
  });
  const id = field(reply.body, "id");
  if (reply.status !== 201 || typeof id !== "string") throw new Error("wallet not created");
  owners.set(id, playerId);
  return id;
}

export interface BetRequest {
  walletId: string;
  externalTransactionId: string;
  amount: string;
}

export interface WagerRequest extends BetRequest {
  kind: string;
  referenceExternalTransactionId?: string;
}

export function wager(instance: ClusterInstance, request: WagerRequest): Promise<HttpResult> {
  return postJson(
    instance,
    "/wagering/transactions",
    {
      providerId: "provider-a",
      externalTransactionId: request.externalTransactionId,
      playerId: ownerOf(request.walletId),
      walletId: request.walletId,
      roundId: "round-1",
      gameId: "game-1",
      kind: request.kind,
      money: { amount: request.amount, currency: "BRL" },
      referenceExternalTransactionId: request.referenceExternalTransactionId,
    },
    { "idempotency-key": `provider-a:${request.externalTransactionId}` },
  );
}

export function bet(instance: ClusterInstance, request: BetRequest): Promise<HttpResult> {
  return wager(instance, { ...request, kind: "BET" });
}

export async function balanceOf(instance: ClusterInstance, walletId: string): Promise<unknown> {
  return field((await getJson(instance, `/wallets/${walletId}`)).body, "balance");
}

export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}
