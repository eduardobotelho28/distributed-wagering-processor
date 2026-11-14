import type { Money, MoneyJSON } from "../money/money";
import type { TransactionKind } from "../transaction/transaction-kind";
import { IntegrationEvent } from "./integration-event";

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  walletId: string;
  kind: TransactionKind;
  amount: MoneyJSON;
  referenceExternalTransactionId: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = "WagerTransactionPendingReference";

  static create(input: {
    eventId: string;
    occurredAt: Date;
    transactionId: string;
    walletId: string;
    kind: TransactionKind;
    amount: Money;
    referenceExternalTransactionId: string;
  }): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference(input.eventId, input.occurredAt, {
      transactionId: input.transactionId,
      walletId: input.walletId,
      kind: input.kind,
      amount: input.amount.toJSON(),
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });
  }
}
