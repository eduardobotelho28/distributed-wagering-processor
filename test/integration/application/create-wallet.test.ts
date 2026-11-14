import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateWalletUseCase } from "../../../src/application/create-wallet/create-wallet.use-case";
import { Money } from "../../../src/domain/money/money";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { WagerTransactionSchema } from "../../../src/infrastructure/persistence/models/wager-transaction.model";
import { SystemClock } from "../../../src/infrastructure/time/system-clock";
import { UuidV7IdGenerator } from "../../../src/infrastructure/time/uuid-v7-id-generator";
import { assertLedgerInvariant } from "../../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
let db: TestDatabase;
let useCase: CreateWalletUseCase;

beforeAll(async () => {
  db = await createTestDatabase();
  useCase = new CreateWalletUseCase(
    new MikroOrmUnitOfWork(db.orm),
    new SystemClock(),
    new UuidV7IdGenerator(),
  );
});

afterAll(async () => {
  await db.dispose();
});

describe("CreateWallet against Postgres", () => {
  test("persists wallet, OPENING and CREDIT entry consistently", async () => {
    const result = await useCase.execute({
      playerId: "player-int-1",
      initialBalance: brl("1000.00"),
    });

    if (result.outcome !== "created") throw new Error("expected created");
    const em = db.orm.em.fork();
    expect(await em.count(WagerTransactionSchema, { walletId: result.wallet.id })).toBe(1);
    await assertLedgerInvariant(em, result.wallet.id);
  });

  test("returns conflict for a duplicate wallet, including under a race", async () => {
    const input = { playerId: "player-int-2", initialBalance: brl("10.00") };

    const results = await Promise.all([
      useCase.execute(input),
      useCase.execute(input),
      useCase.execute(input),
    ]);

    const outcomes = results.map((result) => result.outcome).sort();
    expect(outcomes).toEqual(["conflict", "conflict", "created"]);
    const created = results.find((result) => result.outcome === "created");
    if (created?.outcome !== "created") throw new Error("expected one created");
    await assertLedgerInvariant(db.orm.em.fork(), created.wallet.id);
  });
});
