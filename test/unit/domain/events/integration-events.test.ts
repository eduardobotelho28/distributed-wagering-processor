import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { WagerTransactionPendingReference } from "../../../../src/domain/events/wager-transaction-pending-reference.event";
import { WagerTransactionProcessed } from "../../../../src/domain/events/wager-transaction-processed.event";
import { WagerTransactionRejected } from "../../../../src/domain/events/wager-transaction-rejected.event";
import { WalletBalanceChanged } from "../../../../src/domain/events/wallet-balance-changed.event";
import { Money } from "../../../../src/domain/money/money";
import { OutboxMessage } from "../../../../src/domain/outbox/outbox-message";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";

const base = { eventId: "evt-1", occurredAt: new Date("2026-01-01T00:00:00.000Z") };
const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

describe("integration events", () => {
  test("WagerTransactionProcessed serializes the envelope", () => {
    const event = WagerTransactionProcessed.create({
      ...base,
      transactionId: "tx-1",
      walletId: "w-1",
      kind: TransactionKind.BET,
      amount: brl("10"),
      resultingBalance: brl("90.5"),
    });
    expect(event.toJSON()).toMatchSnapshot();
  });

  test("WagerTransactionRejected serializes the envelope", () => {
    const event = WagerTransactionRejected.create({
      ...base,
      transactionId: "tx-1",
      walletId: "w-1",
      kind: TransactionKind.BET,
      amount: brl("10.00"),
      failureCode: FailureCode.INSUFFICIENT_FUNDS,
    });
    expect(event.toJSON()).toMatchSnapshot();
  });

  test("WalletBalanceChanged serializes the envelope", () => {
    const event = WalletBalanceChanged.create({
      ...base,
      walletId: "w-1",
      transactionId: "tx-1",
      balanceBefore: brl("100.00"),
      balanceAfter: brl("90.00"),
    });
    expect(event.toJSON()).toMatchSnapshot();
  });

  test("WagerTransactionPendingReference serializes the envelope", () => {
    const event = WagerTransactionPendingReference.create({
      ...base,
      transactionId: "tx-2",
      walletId: "w-1",
      kind: TransactionKind.REFUND,
      amount: brl("10.00"),
      referenceExternalTransactionId: "ext-1",
    });
    expect(event.toJSON()).toMatchSnapshot();
  });

  test("is enqueued in the outbox with the serialized envelope", () => {
    const event = WalletBalanceChanged.create({
      ...base,
      walletId: "w-1",
      transactionId: "tx-1",
      balanceBefore: brl("1.00"),
      balanceAfter: brl("2.00"),
    });
    const message = OutboxMessage.enqueue(event);
    expect(message.eventType).toBe("WalletBalanceChanged");
    expect(message.payload).toEqual({ ...event.toJSON() });
  });
});
