import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateWalletUseCase } from "../../../src/application/create-wallet/create-wallet.use-case";
import {
  type SubmitWagerTransactionInput,
  SubmitWagerTransactionUseCase,
} from "../../../src/application/submit-wager-transaction/submit-wager-transaction.use-case";
import { FailureCode } from "../../../src/domain/errors/failure-code";
import { Money } from "../../../src/domain/money/money";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import type { Wallet } from "../../../src/domain/wallet/wallet";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { OutboxMessageSchema } from "../../../src/infrastructure/persistence/models/outbox-message.model";
import { SystemClock } from "../../../src/infrastructure/time/system-clock";
import { UuidV7IdGenerator } from "../../../src/infrastructure/time/uuid-v7-id-generator";
import { assertLedgerInvariant } from "../../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
let db: TestDatabase;
let submit: SubmitWagerTransactionUseCase;
let createWallet: CreateWalletUseCase;

beforeAll(async () => {
  db = await createTestDatabase();
  const unitOfWork = new MikroOrmUnitOfWork(db.orm);
  submit = new SubmitWagerTransactionUseCase(
    unitOfWork,
    new SystemClock(),
    new UuidV7IdGenerator(),
  );
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

function input(
  wallet: Wallet,
  overrides: Partial<SubmitWagerTransactionInput> = {},
): SubmitWagerTransactionInput {
  const externalTransactionId = overrides.externalTransactionId ?? crypto.randomUUID();
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
    context: { correlationId: "corr-1", causationId: null },
    ...overrides,
  };
}

describe("SubmitWagerTransaction against Postgres", () => {
  test("processes, replays and refunds a BET keeping the ledger invariant", async () => {
    const wallet = await newWallet("100.00");
    const bet = input(wallet, { money: brl("30.00") });

    const first = await submit.execute(bet);
    const replay = await submit.execute(bet);
    const refund = await submit.execute(
      input(wallet, {
        kind: TransactionKind.REFUND,
        money: brl("30.00"),
        referenceExternalTransactionId: bet.externalTransactionId,
      }),
    );

    expect(first).toMatchObject({ outcome: "processed", idempotentReplay: false });
    expect(replay).toEqual({ ...first, idempotentReplay: true });
    if (refund.outcome !== "processed") throw new Error("expected processed refund");
    expect(refund.balance.toJSON().amount).toBe("100.00");
    await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
  });

  test("rejects insufficient funds and records a pending reference with its event", async () => {
    const wallet = await newWallet("5.00");

    const rejected = await submit.execute(input(wallet, { money: brl("5.01") }));
    const pending = await submit.execute(
      input(wallet, { kind: TransactionKind.ROLLBACK, referenceExternalTransactionId: "missing" }),
    );

    expect(rejected).toMatchObject({
      outcome: "rejected",
      failureCode: FailureCode.INSUFFICIENT_FUNDS,
    });
    expect(pending.outcome).toBe("pendingReference");
    const events = await db.orm.em
      .fork()
      .count(OutboxMessageSchema, { aggregateId: pending.transactionId });
    expect(events).toBe(1);
    await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
  });

  test("two simultaneous 80.00 bets on 100.00 leave one processed and one rejected", async () => {
    const wallet = await newWallet("100.00");

    const results = await Promise.all([
      submit.execute(input(wallet, { money: brl("80.00") })),
      submit.execute(input(wallet, { money: brl("80.00") })),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual(["processed", "rejected"]);
    const rejected = results.find((result) => result.outcome === "rejected");
    expect(rejected).toMatchObject({ failureCode: FailureCode.INSUFFICIENT_FUNDS });
    await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
  });
});
