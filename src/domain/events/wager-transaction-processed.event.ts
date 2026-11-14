import type { Money, MoneyJSON } from "../money/money";
import type { TransactionKind } from "../transaction/transaction-kind";
import { IntegrationEvent } from "./integration-event";

export interface WagerTransactionProcessedData {
  transactionId: string;
  walletId: string;
  kind: TransactionKind;
  amount: MoneyJSON;
  resultingBalance: MoneyJSON;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = "WagerTransactionProcessed";

  static create(input: {
    eventId: string;
    occurredAt: Date;
    transactionId: string;
    walletId: string;
    kind: TransactionKind;
    amount: Money;
    resultingBalance: Money;
  }): WagerTransactionProcessed {
    return new WagerTransactionProcessed(input.eventId, input.occurredAt, {
      transactionId: input.transactionId,
      walletId: input.walletId,
      kind: input.kind,
      amount: input.amount.toJSON(),
      resultingBalance: input.resultingBalance.toJSON(),
    });
  }
}
