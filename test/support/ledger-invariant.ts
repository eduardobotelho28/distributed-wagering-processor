import type { EntityManager } from "@mikro-orm/postgresql";
import { Money } from "../../src/domain/money/money";
import {
  LedgerDirection,
  type WalletLedgerEntry,
} from "../../src/domain/wallet/wallet-ledger-entry";
import { ledgerEntryToDomain } from "../../src/infrastructure/persistence/mappers/wallet-ledger-entry.mapper";
import { walletToDomain } from "../../src/infrastructure/persistence/mappers/wallet.mapper";
import { WalletLedgerEntrySchema } from "../../src/infrastructure/persistence/models/wallet-ledger-entry.model";
import { WalletSchema } from "../../src/infrastructure/persistence/models/wallet.model";

export class LedgerInvariantError extends Error {
  constructor(walletId: string, violations: string[]) {
    super(`ledger invariant broken for wallet ${walletId}: ${violations.join("; ")}`);
    this.name = "LedgerInvariantError";
  }
}

function signed(entry: WalletLedgerEntry): Money {
  return entry.direction === LedgerDirection.CREDIT ? entry.amount : entry.amount.negate();
}

// Entradas devem chegar ordenadas por (created_at, id), a mesma ordem do extrato.
export function findLedgerViolations(balance: Money, entries: WalletLedgerEntry[]): string[] {
  const violations: string[] = [];
  let sum = Money.zero(balance.currency);
  let previousAfter = Money.zero(balance.currency);
  for (const entry of entries) {
    if (!entry.isBalanced()) violations.push(`entry ${entry.id} is unbalanced`);
    if (!entry.balanceBefore.equals(previousAfter)) {
      violations.push(`entry ${entry.id} does not chain from ${previousAfter.toString()}`);
    }
    sum = sum.add(signed(entry));
    previousAfter = entry.balanceAfter;
  }
  if (!sum.equals(balance)) {
    violations.push(`balance ${balance.toString()} != ledger sum ${sum.toString()}`);
  }
  return violations;
}

export async function assertLedgerInvariant(em: EntityManager, walletId: string): Promise<void> {
  const fork = em.fork();
  const wallet = walletToDomain(await fork.findOneOrFail(WalletSchema, { id: walletId }));
  const models = await fork.find(
    WalletLedgerEntrySchema,
    { walletId },
    { orderBy: { createdAt: "asc", id: "asc" } },
  );
  const entries = models.map((model) => ledgerEntryToDomain(model, wallet.currency));
  const violations = findLedgerViolations(wallet.balance, entries);
  if (violations.length > 0) throw new LedgerInvariantError(walletId, violations);
}
