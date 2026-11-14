import type { Money, MoneyJSON } from "../money/money";
import { type EventOrigin, IntegrationEvent } from "./integration-event";

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  balanceBefore: MoneyJSON;
  balanceAfter: MoneyJSON;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = "WalletBalanceChanged";

  static create(
    input: EventOrigin & {
      walletId: string;
      transactionId: string;
      balanceBefore: Money;
      balanceAfter: Money;
    },
  ): WalletBalanceChanged {
    return new WalletBalanceChanged(
      { ...input, aggregateId: input.walletId },
      {
        walletId: input.walletId,
        transactionId: input.transactionId,
        balanceBefore: input.balanceBefore.toJSON(),
        balanceAfter: input.balanceAfter.toJSON(),
      },
    );
  }
}
