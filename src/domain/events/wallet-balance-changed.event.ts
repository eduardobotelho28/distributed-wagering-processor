import type { MoneyJSON } from "../money/money";
import type { Wallet } from "../wallet/wallet";
import type { LedgerDirection, WalletLedgerEntry } from "../wallet/wallet-ledger-entry";
import { type EventOrigin, IntegrationEvent } from "./integration-event";

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyJSON;
  balanceBefore: MoneyJSON;
  balanceAfter: MoneyJSON;
  walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = "WalletBalanceChanged";
  readonly version = 1;

  // INVARIANT: chamado logo depois de Wallet.debit/credit, com a carteira já na versão que o
  // lançamento produziu; walletVersion permite ao consumidor ordenar e descartar eventos velhos.
  static from(wallet: Wallet, entry: WalletLedgerEntry, origin: EventOrigin): WalletBalanceChanged {
    return new WalletBalanceChanged(
      { ...origin, aggregateId: wallet.id },
      {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.amount.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    );
  }
}
