import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateWalletUseCase } from "../../../src/application/create-wallet/create-wallet.use-case";
import {
  type SubmitWagerTransactionInput,
  SubmitWagerTransactionUseCase,
} from "../../../src/application/submit-wager-transaction/submit-wager-transaction.use-case";
import { Money } from "../../../src/domain/money/money";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import type { Wallet } from "../../../src/domain/wallet/wallet";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { WagerTransactionSchema } from "../../../src/infrastructure/persistence/models/wager-transaction.model";
import { SystemClock } from "../../../src/infrastructure/time/system-clock";
import { UuidV7IdGenerator } from "../../../src/infrastructure/time/uuid-v7-id-generator";
import { assertLedgerInvariant } from "../../support/ledger-invariant";
import { asRecorded, type RecordedSubmitter } from "../../support/submit-fixture";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

const ROUNDS = 10;
const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
let db: TestDatabase;
let submit: RecordedSubmitter;
let createWallet: CreateWalletUseCase;

beforeAll(async () => {
  db = await createTestDatabase();
  const unitOfWork = new MikroOrmUnitOfWork(db.orm);
  submit = asRecorded(
    new SubmitWagerTransactionUseCase(unitOfWork, new SystemClock(), new UuidV7IdGenerator()),
  );
  createWallet = new CreateWalletUseCase(unitOfWork, new SystemClock(), new UuidV7IdGenerator());
});

afterAll(async () => {
  await db.dispose();
});

async function newWallet(): Promise<Wallet> {
  const result = await createWallet.execute({
    playerId: `player-${crypto.randomUUID()}`,
    initialBalance: brl("100.00"),
  });
  if (result.outcome !== "created") throw new Error("expected created");
  return result.wallet;
}

function bet(wallet: Wallet, idempotencyKey: string): SubmitWagerTransactionInput {
  return {
    idempotencyKey,
    providerId: "provider-a",
    externalTransactionId: crypto.randomUUID(),
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: "round-1",
    gameId: "game-1",
    kind: TransactionKind.BET,
    money: brl("10.00"),
    referenceExternalTransactionId: null,
    context: { correlationId: "corr-race", causationId: null },
  };
}

describe("idempotency key race across wallets", () => {
  test("same key sent in parallel to two wallets: one processed, one conflict", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const [first, second] = [await newWallet(), await newWallet()];
      const key = `race-${crypto.randomUUID()}`;

      const results = await Promise.all([
        submit.execute(bet(first, key)),
        submit.execute(bet(second, key)),
      ]);

      const outcomes = results.map((result) => result.outcome).sort();
      expect(outcomes).toEqual(["idempotencyConflict", "processed"]);
      expect(results[0]?.transactionId).toBe(results[1]?.transactionId);
      const rows = await db.orm.em.fork().count(WagerTransactionSchema, { idempotencyKey: key });
      expect(rows).toBe(1);
      await assertLedgerInvariant(db.orm.em.fork(), first.id);
      await assertLedgerInvariant(db.orm.em.fork(), second.id);
    }
  });
});

describe("external transaction id race under different keys", () => {
  test("same externalTransactionId sent in parallel with two keys to two wallets: one processed, one conflict", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const [first, second] = [await newWallet(), await newWallet()];
      const externalTransactionId = crypto.randomUUID();

      const results = await Promise.all([
        submit.execute({ ...bet(first, `key-a-${externalTransactionId}`), externalTransactionId }),
        submit.execute({ ...bet(second, `key-b-${externalTransactionId}`), externalTransactionId }),
      ]);

      const outcomes = results.map((result) => result.outcome).sort();
      expect(outcomes).toEqual(["externalIdConflict", "processed"]);
      expect(results[0]?.transactionId).toBe(results[1]?.transactionId);
      const rows = await db.orm.em
        .fork()
        .count(WagerTransactionSchema, { providerId: "provider-a", externalTransactionId });
      expect(rows).toBe(1);
      await assertLedgerInvariant(db.orm.em.fork(), first.id);
      await assertLedgerInvariant(db.orm.em.fork(), second.id);
    }
  });

  test("same externalTransactionId sent in parallel with two keys to one wallet: one debit", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const wallet = await newWallet();
      const externalTransactionId = crypto.randomUUID();

      const results = await Promise.all([
        submit.execute({ ...bet(wallet, `key-a-${externalTransactionId}`), externalTransactionId }),
        submit.execute({ ...bet(wallet, `key-b-${externalTransactionId}`), externalTransactionId }),
      ]);

      const outcomes = results.map((result) => result.outcome).sort();
      expect(outcomes).toEqual(["externalIdConflict", "processed"]);
      await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
    }
  });
});
