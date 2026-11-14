import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { Money } from "../../../../src/domain/money/money";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import { WagerTransaction } from "../../../../src/domain/transaction/wager-transaction";
import { Wallet } from "../../../../src/domain/wallet/wallet";
import { LedgerDirection } from "../../../../src/domain/wallet/wallet-ledger-entry";
import {
  ledgerEntryToDomain,
  ledgerEntryToModel,
} from "../../../../src/infrastructure/persistence/mappers/wallet-ledger-entry.mapper";
import {
  walletToDomain,
  walletToModel,
} from "../../../../src/infrastructure/persistence/mappers/wallet.mapper";
import {
  wagerTransactionToDomain,
  wagerTransactionToModel,
} from "../../../../src/infrastructure/persistence/mappers/wager-transaction.mapper";

const now = new Date("2026-11-14T12:00:00.000Z");
const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

function buildTransaction(): WagerTransaction {
  return WagerTransaction.create({
    id: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "idem-1",
    providerId: "provider-a",
    externalTransactionId: "ext-2",
    playerId: "player-1",
    walletId: "22222222-2222-4222-8222-222222222222",
    roundId: "round-1",
    gameId: "game-1",
    kind: TransactionKind.REFUND,
    money: brl("10.50"),
    referenceExternalTransactionId: "ext-1",
    payloadHash: "a".repeat(64),
    createdAt: now,
  });
}

describe("wallet mapper", () => {
  test("maps a wallet to its row with decimal string balance and timestamps", () => {
    const wallet = Wallet.rehydrate({
      id: "w-1",
      playerId: "player-1",
      balance: brl("1234567.89"),
      version: 3,
    });

    const model = walletToModel(wallet, { createdAt: now, updatedAt: now });

    expect(model).toEqual({
      id: "w-1",
      playerId: "player-1",
      currency: "BRL",
      balance: "1234567.89",
      version: 3,
      createdAt: now,
      updatedAt: now,
    });
  });

  test("rehydrates a wallet from its row without losing precision", () => {
    const wallet = walletToDomain({
      id: "w-1",
      playerId: "player-1",
      currency: "BRL",
      balance: "0.10",
      version: 2,
      createdAt: now,
      updatedAt: now,
    });

    expect(wallet.id).toBe("w-1");
    expect(wallet.balance.toJSON()).toEqual({ amount: "0.10", currency: "BRL" });
    expect(wallet.version).toBe(2);
  });
});

describe("ledger entry mapper", () => {
  test("roundtrips a debit entry using the wallet currency", () => {
    const wallet = Wallet.rehydrate({
      id: "w-1",
      playerId: "player-1",
      balance: brl("100.00"),
      version: 1,
    });
    const entry = wallet.debit(brl("0.10"), "tx-1", now);

    const model = ledgerEntryToModel(entry);
    const restored = ledgerEntryToDomain(model, "BRL");

    expect(model).toEqual({
      id: "tx-1",
      walletId: "w-1",
      transactionId: "tx-1",
      direction: LedgerDirection.DEBIT,
      amount: "0.10",
      balanceBefore: "100.00",
      balanceAfter: "99.90",
      createdAt: now,
    });
    expect(restored.balanceAfter.toJSON()).toEqual({ amount: "99.90", currency: "BRL" });
    expect(restored.isBalanced()).toBe(true);
    expect(restored.createdAt).toEqual(now);
  });
});

describe("wager transaction mapper", () => {
  test("maps a new transaction with empty persistence-only state", () => {
    const model = wagerTransactionToModel(buildTransaction());

    expect(model.amount).toBe("10.50");
    expect(model.currency).toBe("BRL");
    expect(model.status).toBe(TransactionStatus.PENDING);
    expect(model.resultingBalance).toBeNull();
    expect(model.pendingAttempts).toBe(0);
    expect(model.nextAttemptAt).toBeNull();
  });

  test("writes resulting balance and retry schedule when given", () => {
    const nextAttemptAt = new Date("2026-11-14T12:00:05.000Z");

    const model = wagerTransactionToModel(buildTransaction(), {
      resultingBalance: brl("89.50"),
      pendingAttempts: 2,
      nextAttemptAt,
    });

    expect(model.resultingBalance).toBe("89.50");
    expect(model.pendingAttempts).toBe(2);
    expect(model.nextAttemptAt).toEqual(nextAttemptAt);
  });

  test("roundtrips a rejected transaction through its row", () => {
    const transaction = buildTransaction();
    transaction.reject(FailureCode.REFERENCE_NOT_FOUND);

    const restored = wagerTransactionToDomain(wagerTransactionToModel(transaction));

    expect(restored.status).toBe(TransactionStatus.REJECTED);
    expect(restored.failureCode).toBe(FailureCode.REFERENCE_NOT_FOUND);
    expect(restored.kind).toBe(TransactionKind.REFUND);
    expect(restored.referenceExternalTransactionId).toBe("ext-1");
    expect(restored.money.toJSON()).toEqual({ amount: "10.50", currency: "BRL" });
    expect(restored.createdAt).toEqual(now);
  });

  test("rehydrates a processed transaction without revalidating transitions", () => {
    const transaction = buildTransaction();
    transaction.markProcessed(now, "33333333-3333-4333-8333-333333333333");

    const restored = wagerTransactionToDomain(wagerTransactionToModel(transaction));

    expect(restored.status).toBe(TransactionStatus.PROCESSED);
    expect(restored.referenceTransactionId).toBe("33333333-3333-4333-8333-333333333333");
    expect(restored.processedAt).toEqual(now);
  });
});
