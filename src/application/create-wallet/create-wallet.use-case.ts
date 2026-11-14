import { Money } from "../../domain/money/money";
import { computePayloadHash } from "../../domain/transaction/payload-hash";
import { TransactionKind } from "../../domain/transaction/transaction-kind";
import { WagerTransaction } from "../../domain/transaction/wager-transaction";
import { Wallet } from "../../domain/wallet/wallet";
import { LedgerDirection, WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { TransactionalRepositories, UnitOfWork } from "../ports/unit-of-work";
import { WalletAlreadyExistsError } from "../ports/wallet-already-exists.error";

export interface CreateWalletInput {
  playerId: string;
  initialBalance: Money;
}

export type CreateWalletResult =
  | { outcome: "created"; wallet: Wallet }
  | { outcome: "conflict"; playerId: string; currency: string };

// DECISION: o OPENING é uma transação interna com provedor fixo e id externo derivado da
// carteira; assim é única por carteira e nunca colide com ids de provedores reais.
const INTERNAL_PROVIDER = "internal";
const OPENING_ROUND = "opening";

export class CreateWalletUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: CreateWalletInput): Promise<CreateWalletResult> {
    const conflict: CreateWalletResult = {
      outcome: "conflict",
      playerId: input.playerId,
      currency: input.initialBalance.currency,
    };
    try {
      return await this.unitOfWork.run(async (repositories) => {
        const existing = await repositories.wallets.findByPlayerAndCurrency(
          input.playerId,
          input.initialBalance.currency,
        );
        if (existing !== null) return conflict;
        return { outcome: "created", wallet: await this.create(repositories, input) };
      });
    } catch (error) {
      // INVARIANT: a checagem acima é só atalho; sob corrida o UNIQUE(player_id, currency)
      // decide e o repositório traduz a violação para WalletAlreadyExistsError.
      if (error instanceof WalletAlreadyExistsError) return conflict;
      throw error;
    }
  }

  private async create(
    repositories: TransactionalRepositories,
    input: CreateWalletInput,
  ): Promise<Wallet> {
    const now = this.clock.now();
    const wallet = Wallet.open({
      id: this.ids.next(),
      playerId: input.playerId,
      initialBalance: input.initialBalance,
    });
    await repositories.wallets.insert(wallet, now);
    if (input.initialBalance.isPositive()) await this.recordOpening(repositories, wallet, now);
    return wallet;
  }

  // INVARIANT: saldo inicial > 0 gera OPENING PROCESSED + CREDIT na mesma transação SQL,
  // para que saldo == soma do ledger desde o primeiro instante da carteira.
  private async recordOpening(
    repositories: TransactionalRepositories,
    wallet: Wallet,
    now: Date,
  ): Promise<void> {
    const opening = this.buildOpening(wallet, now);
    opening.markProcessed(now, null);
    await repositories.transactions.insert(opening, {
      resultingBalance: wallet.balance,
      pendingAttempts: 0,
      nextAttemptAt: null,
    });
    await repositories.ledger.insert(
      WalletLedgerEntry.create({
        id: opening.id,
        walletId: wallet.id,
        transactionId: opening.id,
        direction: LedgerDirection.CREDIT,
        amount: wallet.balance,
        balanceBefore: Money.zero(wallet.currency),
        balanceAfter: wallet.balance,
        createdAt: now,
      }),
    );
  }

  private buildOpening(wallet: Wallet, now: Date): WagerTransaction {
    const fields = {
      providerId: INTERNAL_PROVIDER,
      externalTransactionId: `opening:${wallet.id}`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: OPENING_ROUND,
      gameId: OPENING_ROUND,
      money: wallet.balance,
    };
    return WagerTransaction.opening({
      ...fields,
      id: this.ids.next(),
      idempotencyKey: `${INTERNAL_PROVIDER}:${fields.externalTransactionId}`,
      payloadHash: computePayloadHash({ ...fields, kind: TransactionKind.OPENING }),
      createdAt: now,
    });
  }
}
