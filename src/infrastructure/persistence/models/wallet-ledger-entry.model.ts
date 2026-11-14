import { defineEntity, type InferEntity, p } from "@mikro-orm/postgresql";
import { LedgerDirection } from "../../../domain/wallet/wallet-ledger-entry";

// DECISION: wallet_id e transaction_id como uuid simples, sem relação ORM. O repositório
// nunca navega do lançamento para a carteira; relações só trariam lazy loading indesejado.
export const WalletLedgerEntrySchema = defineEntity({
  name: "WalletLedgerEntryModel",
  tableName: "wallet_ledger_entries",
  properties: {
    id: p.uuid().primary(),
    walletId: p.uuid(),
    transactionId: p.uuid(),
    direction: p.enum(() => LedgerDirection),
    amount: p.decimal("string").precision(19).scale(2),
    balanceBefore: p.decimal("string").precision(19).scale(2),
    balanceAfter: p.decimal("string").precision(19).scale(2),
    createdAt: p.datetime(),
  },
});

export type WalletLedgerEntryModel = InferEntity<typeof WalletLedgerEntrySchema>;
