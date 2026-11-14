import type { Clock } from "../../src/application/ports/clock";
import type { IdGenerator } from "../../src/application/ports/id-generator";
import { InvalidLedgerCursorError } from "../../src/application/ports/invalid-ledger-cursor.error";
import type {
  InboxRepositoryPort,
  LedgerPage,
  LedgerPageQuery,
  LedgerRepositoryPort,
  OutboxRepositoryPort,
  StoredWagerTransaction,
  WagerTransactionPersistenceState,
  WagerTransactionRepositoryPort,
  WalletRepositoryPort,
} from "../../src/application/ports/repositories";
import type {
  TransactionalRepositories,
  UnitOfWork,
} from "../../src/application/ports/unit-of-work";
import { WalletAlreadyExistsError } from "../../src/application/ports/wallet-already-exists.error";
import type { InboxMessage } from "../../src/domain/inbox/inbox-message";
import { Money } from "../../src/domain/money/money";
import type { OutboxMessage } from "../../src/domain/outbox/outbox-message";
import { TransactionStatus } from "../../src/domain/transaction/transaction-status";
import type { WagerTransaction } from "../../src/domain/transaction/wager-transaction";
import type { Wallet } from "../../src/domain/wallet/wallet";
import {
  LedgerDirection,
  type WalletLedgerEntry,
} from "../../src/domain/wallet/wallet-ledger-entry";

// Fakes para testes unitários de casos de uso. Não modelam lock nem rollback: concorrência e
// atomicidade são provadas só contra Postgres real nos testes de integração.

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  next(): string {
    this.counter += 1;
    return `00000000-0000-7000-8000-${String(this.counter).padStart(12, "0")}`;
  }
}

export class InMemoryWalletRepository implements WalletRepositoryPort {
  readonly rows = new Map<string, Wallet>();

  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    return this.rows.get(id) ?? null;
  }

  async findById(id: string): Promise<Wallet | null> {
    return this.rows.get(id) ?? null;
  }

  async findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const found = [...this.rows.values()].find(
      (wallet) => wallet.playerId === playerId && wallet.currency === currency,
    );
    return found ?? null;
  }

  async insert(wallet: Wallet): Promise<void> {
    if ((await this.findByPlayerAndCurrency(wallet.playerId, wallet.currency)) !== null) {
      throw new WalletAlreadyExistsError(wallet.playerId, wallet.currency);
    }
    this.rows.set(wallet.id, wallet);
  }

  async saveBalance(wallet: Wallet): Promise<void> {
    this.rows.set(wallet.id, wallet);
  }
}

export class InMemoryWagerTransactionRepository implements WagerTransactionRepositoryPort {
  readonly rows = new Map<string, StoredWagerTransaction>();

  async insert(transaction: WagerTransaction, state = EMPTY_STATE): Promise<void> {
    this.rows.set(transaction.id, { transaction, state });
  }

  async update(transaction: WagerTransaction, state = EMPTY_STATE): Promise<void> {
    this.rows.set(transaction.id, { transaction, state });
  }

  async findById(id: string): Promise<WagerTransaction | null> {
    return this.rows.get(id)?.transaction ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    return this.find((transaction) => transaction.idempotencyKey === idempotencyKey);
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    return this.find(
      (transaction) =>
        transaction.providerId === providerId &&
        transaction.externalTransactionId === externalTransactionId,
    );
  }

  async findProcessedReversalOf(referenceTransactionId: string): Promise<WagerTransaction | null> {
    return this.find(
      (transaction) =>
        transaction.referenceTransactionId === referenceTransactionId &&
        transaction.status === TransactionStatus.PROCESSED,
    );
  }

  async findDuePendingReferenceForUpdateSkipLocked(
    limit: number,
    now: Date,
  ): Promise<StoredWagerTransaction[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.transaction.status === TransactionStatus.PENDING_REFERENCE &&
          row.state.nextAttemptAt !== null &&
          row.state.nextAttemptAt.getTime() <= now.getTime(),
      )
      .slice(0, limit);
  }

  private find(predicate: (transaction: WagerTransaction) => boolean): WagerTransaction | null {
    return [...this.rows.values()].find((row) => predicate(row.transaction))?.transaction ?? null;
  }
}

const EMPTY_STATE: WagerTransactionPersistenceState = {
  resultingBalance: null,
  pendingAttempts: 0,
  nextAttemptAt: null,
};

export class InMemoryLedgerRepository implements LedgerRepositoryPort {
  readonly entries: WalletLedgerEntry[] = [];

  async insert(entry: WalletLedgerEntry): Promise<void> {
    this.entries.push(entry);
  }

  // DECISION: o cursor do fake é o índice da próxima entrada; o formato real é testado na infra.
  async listByWallet(query: LedgerPageQuery): Promise<LedgerPage> {
    const all = this.entries.filter((entry) => entry.walletId === query.walletId);
    if (query.cursor !== null && !/^\d+$/.test(query.cursor)) throw new InvalidLedgerCursorError();
    const start = query.cursor === null ? 0 : Number.parseInt(query.cursor, 10);
    const end = start + query.limit;
    return {
      entries: all.slice(start, end),
      nextCursor: end < all.length ? String(end) : null,
    };
  }

  async sumByWallet(walletId: string, currency: string): Promise<Money> {
    return this.entries
      .filter((entry) => entry.walletId === walletId)
      .reduce(
        (sum, entry) =>
          entry.direction === LedgerDirection.CREDIT
            ? sum.add(entry.amount)
            : sum.subtract(entry.amount),
        Money.zero(currency),
      );
  }
}

export class InMemoryInboxRepository implements InboxRepositoryPort {
  readonly messages: InboxMessage[] = [];

  async tryInsert(message: InboxMessage): Promise<boolean> {
    const duplicate = this.messages.some(
      (stored) =>
        stored.consumerName === message.consumerName && stored.messageId === message.messageId,
    );
    if (duplicate) return false;
    this.messages.push(message);
    return true;
  }

  async markProcessed(): Promise<void> {}
}

export class InMemoryOutboxRepository implements OutboxRepositoryPort {
  readonly messages: OutboxMessage[] = [];

  async insert(message: OutboxMessage): Promise<void> {
    this.messages.push(message);
  }

  async lockDueBatchSkipLocked(limit: number, now: Date): Promise<OutboxMessage[]> {
    return this.messages.filter((message) => message.isDue(now)).slice(0, limit);
  }

  async markPublished(): Promise<void> {}

  async scheduleRetry(): Promise<void> {}
}

export class InMemoryUnitOfWork implements UnitOfWork {
  readonly repositories: TransactionalRepositories & {
    wallets: InMemoryWalletRepository;
    transactions: InMemoryWagerTransactionRepository;
    ledger: InMemoryLedgerRepository;
    inbox: InMemoryInboxRepository;
    outbox: InMemoryOutboxRepository;
  } = {
    wallets: new InMemoryWalletRepository(),
    transactions: new InMemoryWagerTransactionRepository(),
    ledger: new InMemoryLedgerRepository(),
    inbox: new InMemoryInboxRepository(),
    outbox: new InMemoryOutboxRepository(),
  };

  run<TResult>(
    work: (repositories: TransactionalRepositories) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this.repositories);
  }
}
