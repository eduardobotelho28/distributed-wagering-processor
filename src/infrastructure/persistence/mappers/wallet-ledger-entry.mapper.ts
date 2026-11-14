import { WalletLedgerEntry } from "../../../domain/wallet/wallet-ledger-entry";
import { moneyFromColumns } from "../money-columns";
import type { WalletLedgerEntryModel } from "../models/wallet-ledger-entry.model";

// DECISION: a tabela de ledger não tem coluna de moeda; a moeda é a da carteira dona do
// lançamento. Duplicar a coluna abriria espaço para divergência entre ledger e carteira.
export function ledgerEntryToDomain(
  model: WalletLedgerEntryModel,
  currency: string,
): WalletLedgerEntry {
  return WalletLedgerEntry.rehydrate({
    id: model.id,
    walletId: model.walletId,
    transactionId: model.transactionId,
    direction: model.direction,
    amount: moneyFromColumns({ amount: model.amount, currency }),
    balanceBefore: moneyFromColumns({ amount: model.balanceBefore, currency }),
    balanceAfter: moneyFromColumns({ amount: model.balanceAfter, currency }),
    createdAt: model.createdAt,
  });
}

export function ledgerEntryToModel(entry: WalletLedgerEntry): WalletLedgerEntryModel {
  return {
    id: entry.id,
    walletId: entry.walletId,
    transactionId: entry.transactionId,
    direction: entry.direction,
    amount: entry.amount.toJSON().amount,
    balanceBefore: entry.balanceBefore.toJSON().amount,
    balanceAfter: entry.balanceAfter.toJSON().amount,
    createdAt: entry.createdAt,
  };
}
