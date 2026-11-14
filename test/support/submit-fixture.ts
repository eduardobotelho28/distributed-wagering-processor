import { CreateWalletUseCase } from "../../src/application/create-wallet/create-wallet.use-case";
import {
  type SubmitWagerTransactionInput,
  SubmitWagerTransactionUseCase,
} from "../../src/application/submit-wager-transaction/submit-wager-transaction.use-case";
import { Money } from "../../src/domain/money/money";
import { TransactionKind } from "../../src/domain/transaction/transaction-kind";
import type { Wallet } from "../../src/domain/wallet/wallet";
import { FIXED_NOW } from "./factories";
import { FixedClock, InMemoryUnitOfWork, SequentialIdGenerator } from "./fakes";

export const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

export interface SubmitFixture {
  unitOfWork: InMemoryUnitOfWork;
  useCase: SubmitWagerTransactionUseCase;
  wallet: Wallet;
  input(overrides?: Partial<SubmitWagerTransactionInput>): SubmitWagerTransactionInput;
}

let externalCounter = 0;

export async function createSubmitFixture(initialBalance = "100.00"): Promise<SubmitFixture> {
  const unitOfWork = new InMemoryUnitOfWork();
  const clock = new FixedClock(FIXED_NOW);
  const ids = new SequentialIdGenerator();
  const created = await new CreateWalletUseCase(unitOfWork, clock, ids).execute({
    playerId: "player-1",
    initialBalance: brl(initialBalance),
  });
  if (created.outcome !== "created") throw new Error("expected created wallet");
  const wallet = created.wallet;
  return {
    unitOfWork,
    wallet,
    useCase: new SubmitWagerTransactionUseCase(unitOfWork, clock, ids),
    input(overrides = {}) {
      externalCounter += 1;
      const externalTransactionId = overrides.externalTransactionId ?? `ext-${externalCounter}`;
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
    },
  };
}
