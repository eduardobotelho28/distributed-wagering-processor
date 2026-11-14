import { beforeEach, describe, expect, test } from "bun:test";
import { CreateWalletUseCase } from "../../../src/application/create-wallet/create-wallet.use-case";
import {
  GetLedgerUseCase,
  LEDGER_PAGE_MAX_LIMIT,
} from "../../../src/application/queries/get-ledger.use-case";
import { GetTransactionByIdUseCase } from "../../../src/application/queries/get-transaction-by-id.use-case";
import { GetTransactionByProviderExternalIdUseCase } from "../../../src/application/queries/get-transaction-by-provider-external-id.use-case";
import { GetWalletUseCase } from "../../../src/application/queries/get-wallet.use-case";
import { Money } from "../../../src/domain/money/money";
import type { Wallet } from "../../../src/domain/wallet/wallet";
import { FIXED_NOW } from "../../support/factories";
import { FixedClock, InMemoryUnitOfWork, SequentialIdGenerator } from "../../support/fakes";
import { buildWagerTransaction } from "../../support/wager-transaction-builder";

let unitOfWork: InMemoryUnitOfWork;
let wallet: Wallet;

beforeEach(async () => {
  unitOfWork = new InMemoryUnitOfWork();
  const created = await new CreateWalletUseCase(
    unitOfWork,
    new FixedClock(FIXED_NOW),
    new SequentialIdGenerator(),
  ).execute({
    playerId: "player-1",
    initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
  });
  if (created.outcome !== "created") throw new Error("expected created");
  wallet = created.wallet;
});

describe("GetWalletUseCase", () => {
  test("returns the wallet when it exists", async () => {
    const result = await new GetWalletUseCase(unitOfWork).execute(wallet.id);

    if (result.outcome !== "found") throw new Error("expected found");
    expect(result.wallet.balance.toJSON()).toEqual({ amount: "50.00", currency: "BRL" });
  });

  test("returns notFound for an unknown wallet", async () => {
    expect(await new GetWalletUseCase(unitOfWork).execute("missing")).toEqual({
      outcome: "notFound",
    });
  });
});

describe("GetLedgerUseCase", () => {
  test("returns the page of entries of the wallet", async () => {
    const result = await new GetLedgerUseCase(unitOfWork).execute({
      walletId: wallet.id,
      cursor: null,
      limit: 50,
    });

    if (result.outcome !== "found") throw new Error("expected found");
    expect(result.entries.map((entry) => entry.amount.toJSON().amount)).toEqual(["50.00"]);
    expect(result.nextCursor).toBeNull();
  });

  test("returns walletNotFound for an unknown wallet", async () => {
    const result = await new GetLedgerUseCase(unitOfWork).execute({
      walletId: "missing",
      cursor: null,
      limit: 10,
    });

    expect(result).toEqual({ outcome: "walletNotFound" });
  });

  test("returns invalidCursor when the repository rejects the cursor", async () => {
    const result = await new GetLedgerUseCase(unitOfWork).execute({
      walletId: wallet.id,
      cursor: "garbage",
      limit: 10,
    });

    expect(result).toEqual({ outcome: "invalidCursor" });
  });

  test.each([0, -1, 1.5, LEDGER_PAGE_MAX_LIMIT + 1])("rejects limit %p", async (limit) => {
    const result = await new GetLedgerUseCase(unitOfWork).execute({
      walletId: wallet.id,
      cursor: null,
      limit,
    });

    expect(result).toEqual({ outcome: "invalidLimit", max: LEDGER_PAGE_MAX_LIMIT });
  });
});

describe("transaction queries", () => {
  test("finds a transaction by id and by provider external id", async () => {
    const transaction = buildWagerTransaction({ walletId: wallet.id });
    await unitOfWork.repositories.transactions.insert(transaction);

    const byId = await new GetTransactionByIdUseCase(unitOfWork).execute(transaction.id);
    const byExternal = await new GetTransactionByProviderExternalIdUseCase(unitOfWork).execute({
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
    });

    expect(byId).toEqual({ outcome: "found", transaction });
    expect(byExternal).toEqual({ outcome: "found", transaction });
  });

  test("returns notFound for unknown transactions", async () => {
    const byId = await new GetTransactionByIdUseCase(unitOfWork).execute("missing");
    const byExternal = await new GetTransactionByProviderExternalIdUseCase(unitOfWork).execute({
      providerId: "provider-test",
      externalTransactionId: "missing",
    });

    expect(byId).toEqual({ outcome: "notFound" });
    expect(byExternal).toEqual({ outcome: "notFound" });
  });
});
