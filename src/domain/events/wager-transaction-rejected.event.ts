import type { FailureCode } from "../errors/failure-code";
import type { Money, MoneyJSON } from "../money/money";
import type { TransactionKind } from "../transaction/transaction-kind";
import { type EventOrigin, IntegrationEvent } from "./integration-event";

export interface WagerTransactionRejectedData {
  transactionId: string;
  walletId: string;
  kind: TransactionKind;
  amount: MoneyJSON;
  failureCode: FailureCode;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = "WagerTransactionRejected";

  static create(
    input: EventOrigin & {
      transactionId: string;
      walletId: string;
      kind: TransactionKind;
      amount: Money;
      failureCode: FailureCode;
    },
  ): WagerTransactionRejected {
    return new WagerTransactionRejected(
      { ...input, aggregateId: input.transactionId },
      {
        transactionId: input.transactionId,
        walletId: input.walletId,
        kind: input.kind,
        amount: input.amount.toJSON(),
        failureCode: input.failureCode,
      },
    );
  }
}
