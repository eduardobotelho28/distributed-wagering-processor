import type { Money, MoneyJSON } from "../money/money";
import type { TransactionKind } from "../transaction/transaction-kind";
import { type EventOrigin, IntegrationEvent } from "./integration-event";

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  walletId: string;
  kind: TransactionKind;
  amount: MoneyJSON;
  referenceExternalTransactionId: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = "WagerTransactionPendingReference";

  static create(
    input: EventOrigin & {
      transactionId: string;
      walletId: string;
      kind: TransactionKind;
      amount: Money;
      referenceExternalTransactionId: string;
    },
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference(
      { ...input, aggregateId: input.transactionId },
      {
        transactionId: input.transactionId,
        walletId: input.walletId,
        kind: input.kind,
        amount: input.amount.toJSON(),
        referenceExternalTransactionId: input.referenceExternalTransactionId,
      },
    );
  }
}
