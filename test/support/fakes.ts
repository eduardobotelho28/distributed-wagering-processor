import type {
  MessageQueue,
  OutgoingMessage,
  ReceivedMessage,
  ReceiveOptions,
} from "../../src/application/ports/message-queue";
import type { LogFields, Logger } from "../../src/application/ports/logger";
import type {
  CounterLabels,
  CounterName,
  HistogramLabels,
  HistogramName,
  Metrics,
} from "../../src/application/ports/metrics";
import type { Clock } from "../../src/application/ports/clock";
import { DuplicateExternalTransactionError } from "../../src/application/ports/duplicate-external-transaction.error";
import { DuplicateIdempotencyKeyError } from "../../src/application/ports/duplicate-idempotency-key.error";
import type { IdGenerator } from "../../src/application/ports/id-generator";
import { InvalidLedgerCursorError } from "../../src/application/ports/invalid-ledger-cursor.error";
import type {
  InboxRepositoryPort,
  LedgerPage,
  LedgerPageQuery,
  LedgerRepositoryPort,
  LedgerSummary,
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
    if ((await this.findByIdempotencyKey(transaction.idempotencyKey)) !== null) {
      throw new DuplicateIdempotencyKeyError(transaction.idempotencyKey);
    }
    const { providerId, externalTransactionId } = transaction;
    if ((await this.findByProviderAndExternalId(providerId, externalTransactionId)) !== null) {
      throw new DuplicateExternalTransactionError(providerId, externalTransactionId);
    }
    this.rows.set(transaction.id, { transaction, state });
  }

  async update(transaction: WagerTransaction, state = EMPTY_STATE): Promise<void> {
    this.rows.set(transaction.id, { transaction, state });
  }

  async findById(id: string): Promise<WagerTransaction | null> {
    return this.rows.get(id)?.transaction ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<StoredWagerTransaction | null> {
    const rows = [...this.rows.values()];
    return rows.find((row) => row.transaction.idempotencyKey === idempotencyKey) ?? null;
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

  async summarizeByWallet(walletId: string, currency: string): Promise<LedgerSummary> {
    const own = this.entries.filter((entry) => entry.walletId === walletId);
    const total = (direction: LedgerDirection): Money =>
      own
        .filter((entry) => entry.direction === direction)
        .reduce((sum, entry) => sum.add(entry.amount), Money.zero(currency));
    return {
      credits: total(LedgerDirection.CREDIT),
      debits: total(LedgerDirection.DEBIT),
      entryCount: own.length,
    };
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

  readonly processedIds: string[] = [];

  async markProcessed(message: InboxMessage): Promise<void> {
    this.processedIds.push(message.messageId);
  }
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

export class RecordingLogger implements Logger {
  readonly errors: { message: string; fields: LogFields }[] = [];
  readonly infos: { message: string; fields: LogFields }[] = [];
  readonly warnings: { message: string; fields: LogFields }[] = [];

  info(message: string, fields: LogFields = {}): void {
    this.infos.push({ message, fields });
  }

  warn(message: string, fields: LogFields = {}): void {
    this.warnings.push({ message, fields });
  }

  error(message: string, fields: LogFields = {}): void {
    this.errors.push({ message, fields });
  }
}

export class RecordingMetrics implements Metrics {
  readonly counters = new Map<CounterName, number>();
  readonly increments: { name: CounterName; labels: Record<string, string> }[] = [];
  readonly observations: {
    name: HistogramName;
    seconds: number;
    labels: Record<string, string>;
  }[] = [];

  increment<N extends CounterName>(name: N, labels: CounterLabels[N]): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
    this.increments.push({ name, labels: { ...labels } });
  }

  observe<N extends HistogramName>(name: N, seconds: number, labels: HistogramLabels[N]): void {
    this.observations.push({ name, seconds, labels: { ...labels } });
  }
}

export interface QueueCall {
  action: "ack" | "changeVisibility" | "send";
  queue: string;
  receiptHandle?: string;
  timeoutSeconds?: number;
  message?: OutgoingMessage;
}

export class RecordingMessageQueue implements MessageQueue {
  readonly calls: QueueCall[] = [];
  readonly pending: ReceivedMessage[] = [];

  async receive(_queue: string, options: ReceiveOptions): Promise<ReceivedMessage[]> {
    return this.pending.splice(0, options.maxMessages);
  }

  async ack(queue: string, receiptHandle: string): Promise<void> {
    this.calls.push({ action: "ack", queue, receiptHandle });
  }

  async changeVisibility(
    queue: string,
    receiptHandle: string,
    timeoutSeconds: number,
  ): Promise<void> {
    this.calls.push({ action: "changeVisibility", queue, receiptHandle, timeoutSeconds });
  }

  async send(queue: string, message: OutgoingMessage): Promise<void> {
    this.calls.push({ action: "send", queue, message });
  }
}
