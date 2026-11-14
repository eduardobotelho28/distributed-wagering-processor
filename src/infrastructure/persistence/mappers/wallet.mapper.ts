import { Wallet } from "../../../domain/wallet/wallet";
import { moneyFromColumns } from "../money-columns";
import type { WalletModel } from "../models/wallet.model";

export interface WalletTimestamps {
  createdAt: Date;
  updatedAt: Date;
}

export function walletToDomain(model: WalletModel): Wallet {
  return Wallet.rehydrate({
    id: model.id,
    playerId: model.playerId,
    balance: moneyFromColumns({ amount: model.balance, currency: model.currency }),
    version: model.version,
  });
}

// DECISION: timestamps entram por parâmetro; o domínio não modela created_at/updated_at
// e o relógio é injetado por quem chama, mantendo o mapper determinístico.
export function walletToModel(wallet: Wallet, timestamps: WalletTimestamps): WalletModel {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    currency: wallet.currency,
    balance: wallet.balance.toJSON().amount,
    version: wallet.version,
    createdAt: new Date(timestamps.createdAt),
    updatedAt: new Date(timestamps.updatedAt),
  };
}
