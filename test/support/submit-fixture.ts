import { CreateWalletUseCase } from "../../src/application/create-wallet/create-wallet.use-case";
import type { RecordedSubmitResult } from "../../src/application/ports/submit-result";
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

// Os testes de fluxo sempre enviam payload válido; o wrapper estreita o tipo para resultados
// gravados. Validação de payload é testada direto em `rawUseCase`.
export interface RecordedSubmitter {
  execute(input: SubmitWagerTransactionInput): Promise<RecordedSubmitResult>;
}

export function asRecorded(useCase: SubmitWagerTransactionUseCase): RecordedSubmitter {
  return {
    async execute(input) {
      const result = await useCase.execute(input);
      if (result.outcome === "invalidPayload") {
        throw new Error(`invalid payload: ${result.reason}`);
      }
      return result;
    },
  };
}

export interface SubmitFixture {
  unitOfWork: InMemoryUnitOfWork;
  useCase: RecordedSubmitter;
  rawUseCase: SubmitWagerTransactionUseCase;
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
  const rawUseCase = new SubmitWagerTransactionUseCase(unitOfWork, clock, ids);
  return {
    unitOfWork,
    wallet,
    rawUseCase,
    useCase: asRecorded(rawUseCase),
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
