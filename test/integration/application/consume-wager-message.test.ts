import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ConsumeWagerMessageUseCase } from "../../../src/application/consume-wager-message/consume-wager-message.use-case";
import { CreateWalletUseCase } from "../../../src/application/create-wallet/create-wallet.use-case";
import type { SubmitWagerTransactionInput } from "../../../src/application/submit-wager-transaction/submit-wager-transaction.use-case";
import { Money } from "../../../src/domain/money/money";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import type { Wallet } from "../../../src/domain/wallet/wallet";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { InboxMessageSchema } from "../../../src/infrastructure/persistence/models/inbox-message.model";
import { OutboxMessageSchema } from "../../../src/infrastructure/persistence/models/outbox-message.model";
import { WagerTransactionSchema } from "../../../src/infrastructure/persistence/models/wager-transaction.model";
import { WalletLedgerEntrySchema } from "../../../src/infrastructure/persistence/models/wallet-ledger-entry.model";
import { SystemClock } from "../../../src/infrastructure/time/system-clock";
import { UuidV7IdGenerator } from "../../../src/infrastructure/time/uuid-v7-id-generator";
import { assertLedgerInvariant } from "../../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

const CONSUMER = "wager-transactions-consumer";
const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
let db: TestDatabase;
let consume: ConsumeWagerMessageUseCase;
let createWallet: CreateWalletUseCase;

beforeAll(async () => {
  db = await createTestDatabase();
  const unitOfWork = new MikroOrmUnitOfWork(db.orm);
  consume = new ConsumeWagerMessageUseCase(unitOfWork, new SystemClock(), new UuidV7IdGenerator());
  createWallet = new CreateWalletUseCase(unitOfWork, new SystemClock(), new UuidV7IdGenerator());
});

afterAll(async () => {
  await db.dispose();
});

async function newWallet(balance: string): Promise<Wallet> {
  const result = await createWallet.execute({
    playerId: `player-${crypto.randomUUID()}`,
    initialBalance: brl(balance),
  });
  if (result.outcome !== "created") throw new Error("expected created");
  return result.wallet;
}

function bet(wallet: Wallet, messageId: string): SubmitWagerTransactionInput {
  const externalTransactionId = crypto.randomUUID();
  return {
    idempotencyKey: `provider-a:${externalTransactionId}`,
    providerId: "provider-a",
    externalTransactionId,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: "round-1",
    gameId: "game-1",
    kind: TransactionKind.BET,
    money: brl("10.00"),
    referenceExternalTransactionId: null,
    context: { correlationId: messageId, causationId: messageId },
  };
}

async function effectsOf(walletId: string): Promise<number[]> {
  const em = db.orm.em.fork();
  return Promise.all([
    em.count(WagerTransactionSchema, { walletId }),
    em.count(WalletLedgerEntrySchema, { walletId }),
    em.count(OutboxMessageSchema, { eventType: "WalletBalanceChanged", aggregateId: walletId }),
  ]);
}

describe("ConsumeWagerMessage against Postgres", () => {
  test("a redelivered message produces no second effect", async () => {
    const wallet = await newWallet("100.00");
    const messageId = `msg-${crypto.randomUUID()}`;
    const input = { consumerName: CONSUMER, messageId, submission: bet(wallet, messageId) };

    const first = await consume.execute(input);
    const before = await effectsOf(wallet.id);
    const redelivered = await consume.execute(input);

    expect(first).toMatchObject({ outcome: "handled", result: { outcome: "processed" } });
    expect(redelivered).toEqual({ outcome: "duplicate" });
    expect(await effectsOf(wallet.id)).toEqual(before);
    expect(before).toEqual([2, 2, 1]);
    const inbox = await db.orm.em.fork().findOneOrFail(InboxMessageSchema, { messageId });
    expect(inbox.processedAt).not.toBeNull();
    await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
  });

  test("two simultaneous deliveries of the same message apply it once", async () => {
    const wallet = await newWallet("100.00");
    const messageId = `msg-${crypto.randomUUID()}`;
    const input = { consumerName: CONSUMER, messageId, submission: bet(wallet, messageId) };

    const results = await Promise.all([consume.execute(input), consume.execute(input)]);

    expect(results.map((result) => result.outcome).sort()).toEqual(["duplicate", "handled"]);
    expect(await effectsOf(wallet.id)).toEqual([2, 2, 1]);
    await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
  });

  test("an invalid submission records nothing in the inbox", async () => {
    const wallet = await newWallet("100.00");
    const messageId = `msg-${crypto.randomUUID()}`;
    const submission = { ...bet(wallet, messageId), money: brl("0.00") };

    const result = await consume.execute({ consumerName: CONSUMER, messageId, submission });

    expect(result).toMatchObject({ result: { outcome: "invalidPayload" } });
    expect(await db.orm.em.fork().count(InboxMessageSchema, { messageId })).toBe(0);
  });
});
