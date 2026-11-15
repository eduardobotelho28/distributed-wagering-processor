import type { WagerTransactionPersistenceState } from "../../../application/ports/repositories";
import { WagerTransaction } from "../../../domain/transaction/wager-transaction";
import { moneyFromColumns } from "../money-columns";
import type { WagerTransactionModel } from "../models/wager-transaction.model";

export const EMPTY_PERSISTENCE_STATE: WagerTransactionPersistenceState = {
  resultingBalance: null,
  pendingAttempts: 0,
  nextAttemptAt: null,
};

export function wagerTransactionToDomain(model: WagerTransactionModel): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: model.id,
    idempotencyKey: model.idempotencyKey,
    providerId: model.providerId,
    externalTransactionId: model.externalTransactionId,
    playerId: model.playerId,
    walletId: model.walletId,
    roundId: model.roundId,
    gameId: model.gameId,
    kind: model.kind,
    money: moneyFromColumns({ amount: model.amount, currency: model.currency }),
    referenceExternalTransactionId: model.referenceExternalTransactionId ?? null,
    payloadHash: model.payloadHash,
    status: model.status,
    referenceTransactionId: model.referenceTransactionId ?? null,
    failureCode: model.failureCode ?? null,
    processedAt: model.processedAt ?? null,
    createdAt: model.createdAt,
  });
}

export function wagerTransactionStateOf(
  model: WagerTransactionModel,
): WagerTransactionPersistenceState {
  const resultingBalance = model.resultingBalance ?? null;
  return {
    resultingBalance:
      resultingBalance === null
        ? null
        : moneyFromColumns({ amount: resultingBalance, currency: model.currency }),
    pendingAttempts: model.pendingAttempts,
    nextAttemptAt: model.nextAttemptAt ?? null,
  };
}

export function wagerTransactionToModel(
  transaction: WagerTransaction,
  state: WagerTransactionPersistenceState = EMPTY_PERSISTENCE_STATE,
  correlationId: string | null = null,
): WagerTransactionModel {
  return {
    id: transaction.id,
    idempotencyKey: transaction.idempotencyKey,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    playerId: transaction.playerId,
    walletId: transaction.walletId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    amount: transaction.money.toJSON().amount,
    currency: transaction.money.currency,
    referenceExternalTransactionId: transaction.referenceExternalTransactionId,
    referenceTransactionId: transaction.referenceTransactionId,
    payloadHash: transaction.payloadHash,
    status: transaction.status,
    resultingBalance: state.resultingBalance?.toJSON().amount ?? null,
    failureCode: transaction.failureCode,
    pendingAttempts: state.pendingAttempts,
    nextAttemptAt: state.nextAttemptAt === null ? null : new Date(state.nextAttemptAt),
    correlationId,
    processedAt: transaction.processedAt,
    createdAt: transaction.createdAt,
  };
}
