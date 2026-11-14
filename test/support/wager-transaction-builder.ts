import { Money } from "../../src/domain/money/money";
import { TransactionKind } from "../../src/domain/transaction/transaction-kind";
import { WagerTransaction } from "../../src/domain/transaction/wager-transaction";
import { FIXED_NOW } from "./factories";

export interface WagerTransactionOverrides {
  kind?: TransactionKind;
  amount?: string;
  walletId?: string;
  providerId?: string;
  referenceExternalTransactionId?: string | null;
  createdAt?: Date;
}

export function buildWagerTransaction(overrides: WagerTransactionOverrides = {}): WagerTransaction {
  return WagerTransaction.create({
    id: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    providerId: overrides.providerId ?? "provider-test",
    externalTransactionId: crypto.randomUUID(),
    playerId: "player-test",
    walletId: overrides.walletId ?? crypto.randomUUID(),
    roundId: "round-test",
    gameId: "game-test",
    kind: overrides.kind ?? TransactionKind.BET,
    money: Money.from({ amount: overrides.amount ?? "10.00", currency: "BRL" }),
    referenceExternalTransactionId: overrides.referenceExternalTransactionId ?? null,
    payloadHash: "0".repeat(64),
    createdAt: overrides.createdAt ?? FIXED_NOW,
  });
}
