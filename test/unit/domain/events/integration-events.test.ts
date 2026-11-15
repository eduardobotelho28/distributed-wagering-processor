import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { WagerTransactionPendingReference } from "../../../../src/domain/events/wager-transaction-pending-reference.event";
import { WagerTransactionProcessed } from "../../../../src/domain/events/wager-transaction-processed.event";
import { WagerTransactionRejected } from "../../../../src/domain/events/wager-transaction-rejected.event";
import { WalletBalanceChanged } from "../../../../src/domain/events/wallet-balance-changed.event";
import { Money } from "../../../../src/domain/money/money";
import { OutboxMessage } from "../../../../src/domain/outbox/outbox-message";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { Wallet } from "../../../../src/domain/wallet/wallet";
import { LedgerDirection } from "../../../../src/domain/wallet/wallet-ledger-entry";

const base = {
  eventId: "evt-1",
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  correlationId: "corr-1",
  causationId: "msg-1",
};
const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

function debitedWallet(initial: string, amount: string) {
  const wallet = Wallet.open({ id: "w-1", playerId: "p-1", initialBalance: brl(initial) });
  const entry = wallet.debit(brl(amount), "tx-1", base.occurredAt);
  return { wallet, entry };
}

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
    const { wallet, entry } = debitedWallet("100.00", "10.00");
    const event = WalletBalanceChanged.from(wallet, entry, base);
    expect(event.toJSON()).toMatchSnapshot();
  });

  test("WalletBalanceChanged carries direction, money and the wallet version after the move", () => {
    const { wallet, entry } = debitedWallet("100.00", "10.00");

    const event = WalletBalanceChanged.from(wallet, entry, base);

    expect(event.toJSON()).toMatchObject({
      eventType: "WalletBalanceChanged",
      version: 1,
      aggregateId: "w-1",
      data: {
        walletId: "w-1",
        transactionId: "tx-1",
        direction: LedgerDirection.DEBIT,
        money: { amount: "10.00", currency: "BRL" },
        balanceBefore: { amount: "100.00", currency: "BRL" },
        balanceAfter: { amount: "90.00", currency: "BRL" },
        walletVersion: 2,
      },
    });
  });

  test("each concrete event declares its own type and version", () => {
    const processed = WagerTransactionProcessed.create({
      ...base,
      transactionId: "tx-1",
      walletId: "w-1",
      kind: TransactionKind.BET,
      amount: brl("1.00"),
      resultingBalance: brl("1.00"),
    });
    expect(processed.eventType).toBe("WagerTransactionProcessed");
    expect(processed.version).toBe(1);
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
    const { wallet, entry } = debitedWallet("2.00", "1.00");
    const event = WalletBalanceChanged.from(wallet, entry, base);
    const message = OutboxMessage.enqueue(event);
    expect(message.eventType).toBe("WalletBalanceChanged");
    expect(message.payload).toEqual({ ...event.toJSON() });
  });
});
