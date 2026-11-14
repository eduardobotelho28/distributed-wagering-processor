import { beforeEach, describe, expect, test } from "bun:test";
import { CreateWalletUseCase } from "../../../src/application/create-wallet/create-wallet.use-case";
import { WalletAlreadyExistsError } from "../../../src/application/ports/wallet-already-exists.error";
import { Money } from "../../../src/domain/money/money";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../src/domain/transaction/transaction-status";
import { LedgerDirection } from "../../../src/domain/wallet/wallet-ledger-entry";
import { FIXED_NOW } from "../../support/factories";
import { FixedClock, InMemoryUnitOfWork, SequentialIdGenerator } from "../../support/fakes";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
let unitOfWork: InMemoryUnitOfWork;
let useCase: CreateWalletUseCase;

beforeEach(() => {
  unitOfWork = new InMemoryUnitOfWork();
  useCase = new CreateWalletUseCase(
    unitOfWork,
    new FixedClock(FIXED_NOW),
    new SequentialIdGenerator(),
  );
});

describe("CreateWalletUseCase", () => {
  test("creates a wallet with an OPENING transaction and a CREDIT entry", async () => {
    const result = await useCase.execute({ playerId: "player-1", initialBalance: brl("1000.00") });

    if (result.outcome !== "created") throw new Error("expected created");
    expect(result.wallet.balance.toJSON()).toEqual({ amount: "1000.00", currency: "BRL" });
    expect(result.wallet.version).toBe(1);
    const [stored] = [...unitOfWork.repositories.transactions.rows.values()];
    expect(stored?.transaction.kind).toBe(TransactionKind.OPENING);
    expect(stored?.transaction.status).toBe(TransactionStatus.PROCESSED);
    expect(stored?.state.resultingBalance?.toJSON().amount).toBe("1000.00");
    const [entry] = unitOfWork.repositories.ledger.entries;
    expect(entry?.direction).toBe(LedgerDirection.CREDIT);
    expect(entry?.transactionId).toBe(stored?.transaction.id);
    expect(entry?.balanceBefore.toJSON().amount).toBe("0.00");
    expect(entry?.balanceAfter.toJSON().amount).toBe("1000.00");
  });

  test("creates a zero-balance wallet without OPENING or ledger entry", async () => {
    const result = await useCase.execute({ playerId: "player-1", initialBalance: brl("0.00") });

    expect(result.outcome).toBe("created");
    expect(unitOfWork.repositories.transactions.rows.size).toBe(0);
    expect(unitOfWork.repositories.ledger.entries).toEqual([]);
  });

  test("returns conflict for a second wallet with the same player and currency", async () => {
    await useCase.execute({ playerId: "player-1", initialBalance: brl("10.00") });

    const result = await useCase.execute({ playerId: "player-1", initialBalance: brl("5.00") });

    expect(result).toEqual({ outcome: "conflict", playerId: "player-1", currency: "BRL" });
    expect(unitOfWork.repositories.wallets.rows.size).toBe(1);
  });

  test("allows the same player in another currency", async () => {
    await useCase.execute({ playerId: "player-1", initialBalance: brl("10.00") });

    const result = await useCase.execute({
      playerId: "player-1",
      initialBalance: Money.from({ amount: "10.00", currency: "USD" }),
    });

    expect(result.outcome).toBe("created");
  });

  test("maps a unique violation raised by the repository to conflict", async () => {
    unitOfWork.repositories.wallets.findByPlayerAndCurrency = async () => null;
    unitOfWork.repositories.wallets.insert = async () => {
      throw new WalletAlreadyExistsError("player-1", "BRL");
    };

    const result = await useCase.execute({ playerId: "player-1", initialBalance: brl("1.00") });

    expect(result.outcome).toBe("conflict");
  });
});
