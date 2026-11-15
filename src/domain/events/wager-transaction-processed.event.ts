import type { Money, MoneyJSON } from "../money/money";
import type { TransactionKind } from "../transaction/transaction-kind";
import { type EventOrigin, IntegrationEvent } from "./integration-event";

export interface WagerTransactionProcessedData {
  transactionId: string;
  walletId: string;
  kind: TransactionKind;
  amount: MoneyJSON;
  resultingBalance: MoneyJSON;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = "WagerTransactionProcessed";
  readonly version = 1;

  static create(
    input: EventOrigin & {
      transactionId: string;
      walletId: string;
      kind: TransactionKind;
      amount: Money;
      resultingBalance: Money;
    },
  ): WagerTransactionProcessed {
    return new WagerTransactionProcessed(
      { ...input, aggregateId: input.transactionId },
      {
        transactionId: input.transactionId,
        walletId: input.walletId,
        kind: input.kind,
        amount: input.amount.toJSON(),
        resultingBalance: input.resultingBalance.toJSON(),
      },
    );
  }
}
