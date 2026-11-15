import {
  type EntityManager,
  LockMode,
  UniqueConstraintViolationException,
} from "@mikro-orm/postgresql";
import { DuplicateExternalTransactionError } from "../../../application/ports/duplicate-external-transaction.error";
import { DuplicateIdempotencyKeyError } from "../../../application/ports/duplicate-idempotency-key.error";
import type {
  StoredWagerTransaction,
  WagerTransactionPersistenceState,
  WagerTransactionRepositoryPort,
} from "../../../application/ports/repositories";
import { TransactionStatus } from "../../../domain/transaction/transaction-status";
import type { WagerTransaction } from "../../../domain/transaction/wager-transaction";
import {
  EMPTY_PERSISTENCE_STATE,
  wagerTransactionStateOf,
  wagerTransactionToDomain,
  wagerTransactionToModel,
} from "../mappers/wager-transaction.mapper";
import {
  type WagerTransactionModel,
  WagerTransactionSchema,
} from "../models/wager-transaction.model";

export class WagerTransactionNotPersistedError extends Error {
  constructor(transactionId: string) {
    super(`wager transaction ${transactionId} was not updated`);
    this.name = "WagerTransactionNotPersistedError";
  }
}

function toDomainOrNull(model: WagerTransactionModel | null): WagerTransaction | null {
  return model === null ? null : wagerTransactionToDomain(model);
}

const IDEMPOTENCY_KEY_CONSTRAINT = "wager_transactions_idempotency_key_unique";
const PROVIDER_EXTERNAL_CONSTRAINT = "wager_transactions_provider_external_unique";

// RISK: o MikroORM não expõe o nome da constraint em campo tipado; ele vem na mensagem do
// Postgres. Os testes idempotency-key-race e external-id-conflict quebram se o formato mudar.
function isViolationOf(error: unknown, constraint: string): boolean {
  return error instanceof UniqueConstraintViolationException && error.message.includes(constraint);
}

function toStored(model: WagerTransactionModel): StoredWagerTransaction {
  return {
    transaction: wagerTransactionToDomain(model),
    state: wagerTransactionStateOf(model),
    correlationId: model.correlationId ?? null,
  };
}

// DECISION: mesma política do WalletRepository: leituras fora do identity map, escritas nativas.
export class WagerTransactionRepository implements WagerTransactionRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  // INVARIANT: duplicidade de idempotency_key / (provider, external id) é barrada pelos UNIQUE
  // do banco. A violação da key vira DuplicateIdempotencyKeyError; o caso de uso relê a key numa
  // transação nova e decide entre replay e conflito.
  async insert(
    transaction: WagerTransaction,
    state: WagerTransactionPersistenceState = EMPTY_PERSISTENCE_STATE,
    correlationId: string | null = null,
  ): Promise<void> {
    try {
      const model = wagerTransactionToModel(transaction, state, correlationId);
      await this.em.insert(WagerTransactionSchema, model);
    } catch (error) {
      if (isViolationOf(error, IDEMPOTENCY_KEY_CONSTRAINT)) {
        throw new DuplicateIdempotencyKeyError(transaction.idempotencyKey);
      }
      if (isViolationOf(error, PROVIDER_EXTERNAL_CONSTRAINT)) {
        throw new DuplicateExternalTransactionError(
          transaction.providerId,
          transaction.externalTransactionId,
        );
      }
      throw error;
    }
  }

  async update(
    transaction: WagerTransaction,
    state: WagerTransactionPersistenceState = EMPTY_PERSISTENCE_STATE,
  ): Promise<void> {
    const model = wagerTransactionToModel(transaction, state);
    const affected = await this.em.nativeUpdate(
      WagerTransactionSchema,
      { id: transaction.id },
      {
        status: model.status,
        referenceTransactionId: model.referenceTransactionId,
        failureCode: model.failureCode,
        processedAt: model.processedAt,
        resultingBalance: model.resultingBalance,
        pendingAttempts: model.pendingAttempts,
        nextAttemptAt: model.nextAttemptAt,
      },
    );
    if (affected !== 1) throw new WagerTransactionNotPersistedError(transaction.id);
  }

  async findById(id: string): Promise<WagerTransaction | null> {
    return toDomainOrNull(await this.findOne({ id }));
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<StoredWagerTransaction | null> {
    const model = await this.findOne({ idempotencyKey });
    return model === null ? null : toStored(model);
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    return toDomainOrNull(await this.findOne({ providerId, externalTransactionId }));
  }

  async findProcessedReversalOf(referenceTransactionId: string): Promise<WagerTransaction | null> {
    return toDomainOrNull(
      await this.findOne({ referenceTransactionId, status: TransactionStatus.PROCESSED }),
    );
  }

  // DECISION: FOR UPDATE SKIP LOCKED; várias instâncias do worker pegam lotes disjuntos
  // sem se bloquear. Precisa rodar dentro de uma transação.
  async findDuePendingReferenceForUpdateSkipLocked(
    limit: number,
    now: Date,
  ): Promise<StoredWagerTransaction[]> {
    const models = await this.em.find(
      WagerTransactionSchema,
      { status: TransactionStatus.PENDING_REFERENCE, nextAttemptAt: { $lte: now } },
      {
        orderBy: { nextAttemptAt: "asc", id: "asc" },
        limit,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        disableIdentityMap: true,
      },
    );
    return models.map(toStored);
  }

  private findOne(where: Partial<WagerTransactionModel>): Promise<WagerTransactionModel | null> {
    return this.em.findOne(WagerTransactionSchema, where, { disableIdentityMap: true });
  }
}
