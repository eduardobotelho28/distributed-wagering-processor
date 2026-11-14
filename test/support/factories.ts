import type { EntityManager } from "@mikro-orm/postgresql";
import { Money } from "../../src/domain/money/money";
import { TransactionKind } from "../../src/domain/transaction/transaction-kind";
import { WagerTransaction } from "../../src/domain/transaction/wager-transaction";
import { Wallet } from "../../src/domain/wallet/wallet";
import { ledgerEntryToModel } from "../../src/infrastructure/persistence/mappers/wallet-ledger-entry.mapper";
import { walletToModel } from "../../src/infrastructure/persistence/mappers/wallet.mapper";
import { wagerTransactionToModel } from "../../src/infrastructure/persistence/mappers/wager-transaction.mapper";
import { WagerTransactionSchema } from "../../src/infrastructure/persistence/models/wager-transaction.model";
import { WalletLedgerEntrySchema } from "../../src/infrastructure/persistence/models/wallet-ledger-entry.model";
import { WalletSchema } from "../../src/infrastructure/persistence/models/wallet.model";

export const FIXED_NOW = new Date("2026-11-14T12:00:00.000Z");

// DECISION: relógio de teste que avança 1ms por chamada. O ledger é ordenado por
// (created_at, id); com o mesmo instante, ids aleatórios embaralhariam a cadeia.
let ticks = 0;
export function nextTick(): Date {
  ticks += 1;
  return new Date(FIXED_NOW.getTime() + ticks);
}

export interface SeedWalletInput {
  balance: string;
  currency?: string;
  playerId?: string;
}

export interface MovementInput {
  kind: TransactionKind.BET | TransactionKind.WIN;
  amount: string;
  at?: Date;
}

function buildTransaction(wallet: Wallet, kind: TransactionKind, money: Money, at: Date) {
  const input = {
    id: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    providerId: "provider-test",
    externalTransactionId: crypto.randomUUID(),
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: "round-test",
    gameId: "game-test",
    money,
    payloadHash: "0".repeat(64),
    createdAt: at,
  };
  if (kind === TransactionKind.OPENING) return WagerTransaction.opening(input);
  return WagerTransaction.create({ ...input, kind, referenceExternalTransactionId: null });
}

// INVARIANT: todo saldo semeado nasce de um lançamento OPENING, para que
// assertLedgerInvariant valha desde o primeiro estado da carteira.
export async function seedWallet(em: EntityManager, input: SeedWalletInput): Promise<Wallet> {
  const currency = input.currency ?? "BRL";
  const wallet = Wallet.open({
    id: crypto.randomUUID(),
    playerId: input.playerId ?? `player-${crypto.randomUUID()}`,
    initialBalance: Money.zero(currency),
  });
  await em.insert(
    WalletSchema,
    walletToModel(wallet, { createdAt: FIXED_NOW, updatedAt: FIXED_NOW }),
  );
  const opening = Money.from({ amount: input.balance, currency });
  if (opening.isPositive()) {
    await applyMovement(em, wallet, TransactionKind.OPENING, opening, nextTick());
  }
  return wallet;
}

export async function recordMovement(
  em: EntityManager,
  wallet: Wallet,
  input: MovementInput,
): Promise<void> {
  const money = Money.from({ amount: input.amount, currency: wallet.currency });
  await applyMovement(em, wallet, input.kind, money, input.at ?? nextTick());
}

async function applyMovement(
  em: EntityManager,
  wallet: Wallet,
  kind: TransactionKind,
  money: Money,
  at: Date,
): Promise<void> {
  const transaction = buildTransaction(wallet, kind, money, at);
  const entry =
    kind === TransactionKind.BET
      ? wallet.debit(money, transaction.id, at)
      : wallet.credit(money, transaction.id, at);
  transaction.markProcessed(at, null);
  await em.insert(
    WagerTransactionSchema,
    wagerTransactionToModel(transaction, {
      resultingBalance: wallet.balance,
      pendingAttempts: 0,
      nextAttemptAt: null,
    }),
  );
  await em.insert(WalletLedgerEntrySchema, ledgerEntryToModel(entry));
  await em.nativeUpdate(
    WalletSchema,
    { id: wallet.id },
    { balance: wallet.balance.toJSON().amount, version: wallet.version, updatedAt: at },
  );
}
