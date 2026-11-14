import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import { LedgerDirection } from "../../../src/domain/wallet/wallet-ledger-entry";
import { wagerTransactionToModel } from "../../../src/infrastructure/persistence/mappers/wager-transaction.mapper";
import { WagerTransactionSchema } from "../../../src/infrastructure/persistence/models/wager-transaction.model";
import {
  type WalletLedgerEntryModel,
  WalletLedgerEntrySchema,
} from "../../../src/infrastructure/persistence/models/wallet-ledger-entry.model";
import { WalletSchema } from "../../../src/infrastructure/persistence/models/wallet.model";
import { FIXED_NOW, recordMovement, seedWallet } from "../../support/factories";
import { assertLedgerInvariant } from "../../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";
import { buildWagerTransaction } from "../../support/wager-transaction-builder";

// UPDATE/DELETE no ledger e a segunda reversão processada já são cobertos pelos testes das
// migrations T33 e T35. Aqui as escritas vão direto pelos modelos, sem passar pelo domínio,
// para provar que o banco é a última barreira mesmo quando a regra de código é contornada.

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.dispose();
});

async function insertTransactionRow(walletId: string): Promise<string> {
  const transaction = buildWagerTransaction({ walletId });
  await db.orm.em.fork().insert(WagerTransactionSchema, wagerTransactionToModel(transaction));
  return transaction.id;
}

async function ledgerRow(
  overrides: Partial<WalletLedgerEntryModel>,
): Promise<WalletLedgerEntryModel> {
  const wallet = await seedWallet(db.orm.em.fork(), { balance: "0.00" });
  const transactionId = await insertTransactionRow(wallet.id);
  return {
    id: transactionId,
    walletId: wallet.id,
    transactionId,
    direction: LedgerDirection.CREDIT,
    amount: "10.00",
    balanceBefore: "0.00",
    balanceAfter: "10.00",
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

describe("wallet constraints", () => {
  test("rejects a negative balance", async () => {
    const em = db.orm.em.fork();
    const wallet = await seedWallet(em, { balance: "1.00" });

    const update = em.nativeUpdate(WalletSchema, { id: wallet.id }, { balance: "-0.01" });

    await expect(update).rejects.toThrow("wallets_balance_non_negative");
    await assertLedgerInvariant(em, wallet.id);
  });

  test("rejects a second wallet for the same player and currency", async () => {
    const em = db.orm.em.fork();
    const wallet = await seedWallet(em, { balance: "0.00" });

    const duplicate = seedWallet(em, { balance: "0.00", playerId: wallet.playerId });

    await expect(duplicate).rejects.toThrow("wallets_player_id_currency_unique");
  });
});

describe("wager transaction constraints", () => {
  test("rejects a duplicate idempotency key", async () => {
    const first = buildWagerTransaction();
    const second = buildWagerTransaction();
    const em = db.orm.em.fork();
    await em.insert(WagerTransactionSchema, wagerTransactionToModel(first));

    const insert = em.insert(WagerTransactionSchema, {
      ...wagerTransactionToModel(second),
      idempotencyKey: first.idempotencyKey,
    });

    await expect(insert).rejects.toThrow("wager_transactions_idempotency_key_unique");
  });

  test("rejects a duplicate external id from the same provider", async () => {
    const first = buildWagerTransaction();
    const second = buildWagerTransaction({ providerId: first.providerId });
    const em = db.orm.em.fork();
    await em.insert(WagerTransactionSchema, wagerTransactionToModel(first));

    const insert = em.insert(WagerTransactionSchema, {
      ...wagerTransactionToModel(second),
      externalTransactionId: first.externalTransactionId,
    });

    await expect(insert).rejects.toThrow("wager_transactions_provider_external_unique");
  });

  test("rejects a reversal without a reference", async () => {
    const refund = buildWagerTransaction({
      kind: TransactionKind.REFUND,
      referenceExternalTransactionId: "ext-ref",
    });

    const insert = db.orm.em.fork().insert(WagerTransactionSchema, {
      ...wagerTransactionToModel(refund),
      referenceExternalTransactionId: null,
    });

    await expect(insert).rejects.toThrow("wager_transactions_reversal_reference_check");
  });
});

describe("ledger constraints", () => {
  test("rejects an unbalanced entry", async () => {
    const row = await ledgerRow({ balanceAfter: "10.01" });

    const insert = db.orm.em.fork().insert(WalletLedgerEntrySchema, row);

    await expect(insert).rejects.toThrow("wallet_ledger_entries_balanced_check");
  });

  test("rejects a non-positive amount", async () => {
    const row = await ledgerRow({ amount: "0.00", balanceAfter: "0.00" });

    const insert = db.orm.em.fork().insert(WalletLedgerEntrySchema, row);

    await expect(insert).rejects.toThrow("wallet_ledger_entries_amount_positive");
  });

  test("rejects a debit that leaves a negative balance", async () => {
    const row = await ledgerRow({
      direction: LedgerDirection.DEBIT,
      amount: "10.00",
      balanceBefore: "0.00",
      balanceAfter: "-10.00",
    });

    const insert = db.orm.em.fork().insert(WalletLedgerEntrySchema, row);

    await expect(insert).rejects.toThrow("wallet_ledger_entries_balance_after_non_negative");
  });

  test("rejects a second entry for the same wallet and transaction", async () => {
    const em = db.orm.em.fork();
    const wallet = await seedWallet(em, { balance: "5.00" });
    await recordMovement(em, wallet, { kind: TransactionKind.BET, amount: "1.00" });
    const [entry] = await em.fork().find(WalletLedgerEntrySchema, { walletId: wallet.id });
    if (entry === undefined) throw new Error("entry not found");

    const insert = em.insert(WalletLedgerEntrySchema, { ...entry, id: crypto.randomUUID() });

    await expect(insert).rejects.toThrow("wallet_ledger_entries_wallet_transaction_unique");
    await assertLedgerInvariant(em, wallet.id);
  });
});
