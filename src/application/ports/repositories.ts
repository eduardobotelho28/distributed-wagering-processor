import type { InboxMessage } from "../../domain/inbox/inbox-message";
import type { Money } from "../../domain/money/money";
import type { OutboxMessage } from "../../domain/outbox/outbox-message";
import type { WagerTransaction } from "../../domain/transaction/wager-transaction";
import type { Wallet } from "../../domain/wallet/wallet";
import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";

export interface WalletRepositoryPort {
  // INVARIANT: PESSIMISTIC_WRITE na linha da carteira; só dentro do UnitOfWork.
  findByIdForUpdate(id: string): Promise<Wallet | null>;
  findById(id: string): Promise<Wallet | null>;
  findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;
  insert(wallet: Wallet, now: Date): Promise<void>;
  saveBalance(wallet: Wallet, now: Date): Promise<void>;
}

// DECISION: estado que só existe na persistência (saldo resultante para replay e agenda de
// retentativa do PENDING_REFERENCE) fica fora do agregado e viaja ao lado dele.
export interface WagerTransactionPersistenceState {
  resultingBalance: Money | null;
  pendingAttempts: number;
  nextAttemptAt: Date | null;
}

export interface StoredWagerTransaction {
  transaction: WagerTransaction;
  state: WagerTransactionPersistenceState;
}

export interface WagerTransactionRepositoryPort {
  // Lança DuplicateIdempotencyKeyError quando a key já foi gravada por outra transação.
  insert(transaction: WagerTransaction, state?: WagerTransactionPersistenceState): Promise<void>;
  update(transaction: WagerTransaction, state?: WagerTransactionPersistenceState): Promise<void>;
  findById(id: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<StoredWagerTransaction | null>;
  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;
  findProcessedReversalOf(referenceTransactionId: string): Promise<WagerTransaction | null>;
  findDuePendingReferenceForUpdateSkipLocked(
    limit: number,
    now: Date,
  ): Promise<StoredWagerTransaction[]>;
}

export interface LedgerPageQuery {
  walletId: string;
  currency: string;
  cursor: string | null;
  limit: number;
}

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  nextCursor: string | null;
}

// DECISION: créditos e débitos separados (ambos >= 0) em vez de uma soma assinada; a
// diferença é calculada em Money, então até um ledger corrompido é lido sem estourar.
export interface LedgerSummary {
  credits: Money;
  debits: Money;
  entryCount: number;
}

export interface LedgerRepositoryPort {
  insert(entry: WalletLedgerEntry): Promise<void>;
  // Lança InvalidLedgerCursorError quando o cursor não foi emitido por esta implementação.
  listByWallet(query: LedgerPageQuery): Promise<LedgerPage>;
  summarizeByWallet(walletId: string, currency: string): Promise<LedgerSummary>;
}

export interface InboxRepositoryPort {
  tryInsert(message: InboxMessage): Promise<boolean>;
  find(consumerName: string, messageId: string): Promise<InboxMessage | null>;
  markProcessed(message: InboxMessage): Promise<void>;
}

export interface OutboxRepositoryPort {
  insert(message: OutboxMessage): Promise<void>;
  lockDueBatchSkipLocked(limit: number, now: Date): Promise<OutboxMessage[]>;
  markPublished(message: OutboxMessage): Promise<void>;
  scheduleRetry(message: OutboxMessage): Promise<void>;
}
