import { FailureCode } from "../../domain/errors/failure-code";
import { WagerTransactionPendingReference } from "../../domain/events/wager-transaction-pending-reference.event";
import { OutboxMessage } from "../../domain/outbox/outbox-message";
import { InvariantViolationError } from "../../domain/errors/invariant-violation.error";
import type { Money } from "../../domain/money/money";
import { computePayloadHash } from "../../domain/transaction/payload-hash";
import { checkReversal } from "../../domain/transaction/reversal-policy";
import type { TransactionKind } from "../../domain/transaction/transaction-kind";
import { TransactionStatus } from "../../domain/transaction/transaction-status";
import { WagerTransaction } from "../../domain/transaction/wager-transaction";
import type { Wallet } from "../../domain/wallet/wallet";
import { LedgerDirection } from "../../domain/wallet/wallet-ledger-entry";
import type { Clock } from "../ports/clock";
import type { EventContext } from "../ports/event-context";
import type { IdGenerator } from "../ports/id-generator";
import type {
  StoredWagerTransaction,
  WagerTransactionPersistenceState,
} from "../ports/repositories";
import type { SubmitResult } from "../ports/submit-result";
import type { TransactionalRepositories, UnitOfWork } from "../ports/unit-of-work";

export interface SubmitWagerTransactionInput {
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: TransactionKind;
  money: Money;
  referenceExternalTransactionId: string | null;
  context: EventContext;
}

interface Submission {
  repositories: TransactionalRepositories;
  transaction: WagerTransaction;
  wallet: Wallet;
  now: Date;
}

interface Movement {
  direction: LedgerDirection;
  referenceTransactionId: string | null;
  overdraftCode: FailureCode;
}

export class SubmitWagerTransactionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  // DECISION: lock da carteira ANTES da busca pela idempotency key. Duas entregas da mesma
  // key para a mesma carteira serializam no lock; a segunda só procura a key depois que a
  // primeira commitou, então enxerga a transação gravada e vira replay em vez de duplicar.
  // Buscar antes do lock abriria a janela "ambas não acham, ambas processam".
  execute(input: SubmitWagerTransactionInput): Promise<SubmitResult> {
    return this.unitOfWork.run(async (repositories) => {
      const wallet = await repositories.wallets.findByIdForUpdate(input.walletId);
      const payloadHash = computePayloadHash(input);
      const existing = await repositories.transactions.findByIdempotencyKey(input.idempotencyKey);
      if (existing !== null) return replayOrConflict(existing, payloadHash);
      const now = this.clock.now();
      const transaction = this.buildTransaction(input, payloadHash, now);
      if (wallet === null) {
        return this.reject(repositories, transaction, FailureCode.WALLET_NOT_FOUND, null);
      }
      return this.process({ repositories, transaction, wallet, now });
    });
  }

  private buildTransaction(
    input: SubmitWagerTransactionInput,
    payloadHash: string,
    now: Date,
  ): WagerTransaction {
    return WagerTransaction.create({
      id: this.ids.next(),
      idempotencyKey: input.idempotencyKey,
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
      payloadHash,
      createdAt: now,
    });
  }

  private async process(submission: Submission): Promise<SubmitResult> {
    const { repositories, transaction, wallet } = submission;
    if (transaction.money.currency !== wallet.currency) {
      return this.reject(repositories, transaction, FailureCode.CURRENCY_MISMATCH, wallet.balance);
    }
    if (!transaction.affectsBalance()) return this.recordWithoutMovement(submission);
    if (transaction.requiresReference()) return this.processReversal(submission);
    return this.applyMovement(submission, {
      direction: transaction.ledgerDirectionFor(),
      referenceTransactionId: null,
      overdraftCode: FailureCode.INSUFFICIENT_FUNDS,
    });
  }

  // INVARIANT: transação, lançamento e saldo são gravados na mesma transação SQL do lock.
  // INVARIANT: débito sem saldo vira REJECTED antes de tocar a carteira; o saldo nunca fica
  // negativo (também barrado por Wallet.debit e pelo CHECK balance >= 0).
  private async applyMovement(submission: Submission, movement: Movement): Promise<SubmitResult> {
    const { repositories, transaction, wallet, now } = submission;
    const { direction, referenceTransactionId, overdraftCode } = movement;
    if (direction === LedgerDirection.DEBIT && wallet.balance.isLessThan(transaction.money)) {
      return this.reject(repositories, transaction, overdraftCode, wallet.balance);
    }
    const entry =
      direction === LedgerDirection.DEBIT
        ? wallet.debit(transaction.money, transaction.id, now)
        : wallet.credit(transaction.money, transaction.id, now);
    transaction.markProcessed(now, referenceTransactionId);
    await repositories.transactions.insert(transaction, settled(wallet.balance));
    await repositories.ledger.insert(entry);
    await repositories.wallets.saveBalance(wallet, now);
    return processed(transaction, wallet.balance);
  }

  private async processReversal(submission: Submission): Promise<SubmitResult> {
    const { repositories, transaction, wallet } = submission;
    const reference = await repositories.transactions.findByProviderAndExternalId(
      transaction.providerId,
      requireReferenceExternalId(transaction),
    );
    if (reference === null || isUnresolved(reference)) return this.pendReference(submission);
    const verdict = checkReversal(transaction, reference);
    if (!verdict.ok) {
      return this.reject(repositories, transaction, verdict.failureCode, wallet.balance);
    }
    // INVARIANT: também garantido pelo índice único parcial de reversão (migration T35);
    // esta consulta só transforma a violação em REJECTED auditável.
    if ((await repositories.transactions.findProcessedReversalOf(reference.id)) !== null) {
      const code = FailureCode.REFERENCE_ALREADY_REVERSED;
      return this.reject(repositories, transaction, code, wallet.balance);
    }
    return this.applyMovement(submission, {
      direction: transaction.ledgerDirectionFor(reference),
      referenceTransactionId: reference.id,
      overdraftCode: FailureCode.REVERSAL_WOULD_OVERDRAW,
    });
  }

  private async pendReference(submission: Submission): Promise<SubmitResult> {
    const { repositories, transaction, now } = submission;
    transaction.markPendingReference();
    await repositories.transactions.insert(transaction, {
      resultingBalance: null,
      pendingAttempts: 0,
      nextAttemptAt: new Date(now.getTime() + PENDING_REFERENCE_FIRST_RETRY_MS),
    });
    // INVARIANT: o evento vai para o outbox na mesma transação SQL; só é publicado após o commit.
    const event = WagerTransactionPendingReference.create({
      eventId: this.ids.next(),
      occurredAt: now,
      transactionId: transaction.id,
      walletId: transaction.walletId,
      kind: transaction.kind,
      amount: transaction.money,
      referenceExternalTransactionId: requireReferenceExternalId(transaction),
    });
    await repositories.outbox.insert(OutboxMessage.enqueue(event, transaction.id));
    return { outcome: "pendingReference", transactionId: transaction.id, idempotentReplay: false };
  }

  // DECISION: LOSS fecha a rodada sem lançamento; o débito já ocorreu no BET. O saldo
  // resultante gravado é o atual, para o replay responder o mesmo valor.
  private async recordWithoutMovement(submission: Submission): Promise<SubmitResult> {
    const { repositories, transaction, wallet, now } = submission;
    transaction.markProcessed(now, null);
    await repositories.transactions.insert(transaction, settled(wallet.balance));
    return processed(transaction, wallet.balance);
  }

  private async reject(
    repositories: TransactionalRepositories,
    transaction: WagerTransaction,
    failureCode: FailureCode,
    balance: Money | null,
  ): Promise<SubmitResult> {
    transaction.reject(failureCode);
    await repositories.transactions.insert(transaction, settled(balance));
    return {
      outcome: "rejected",
      transactionId: transaction.id,
      failureCode,
      balance,
      idempotentReplay: false,
    };
  }
}

// DECISION: primeira retentativa 5s depois; é a base do backoff do reprocessamento (T58).
// Referência que chega fora de ordem costuma chegar em segundos.
export const PENDING_REFERENCE_FIRST_RETRY_MS = 5_000;

const UNRESOLVED_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  TransactionStatus.PENDING,
  TransactionStatus.PENDING_REFERENCE,
]);

// DECISION: referência ainda pendente é tratada como ausente; reverter algo que não moveu
// saldo seria incorreto, e ela pode se resolver depois.
function isUnresolved(reference: WagerTransaction): boolean {
  return UNRESOLVED_STATUSES.has(reference.status);
}

function requireReferenceExternalId(transaction: WagerTransaction): string {
  const referenceId = transaction.referenceExternalTransactionId;
  if (referenceId === null) throw new InvariantViolationError("reversal without reference");
  return referenceId;
}

function settled(resultingBalance: Money | null): WagerTransactionPersistenceState {
  return { resultingBalance, pendingAttempts: 0, nextAttemptAt: null };
}

function processed(transaction: WagerTransaction, balance: Money): SubmitResult {
  return { outcome: "processed", transactionId: transaction.id, balance, idempotentReplay: false };
}

// DECISION: o replay responde com o saldo gravado em resulting_balance no momento do
// processamento, não com o saldo atual; a mesma requisição recebe sempre a mesma resposta.
function replayOrConflict(existing: StoredWagerTransaction, payloadHash: string): SubmitResult {
  const { transaction, state } = existing;
  const base = { transactionId: transaction.id, idempotentReplay: true };
  if (!transaction.matchesPayload(payloadHash)) {
    return {
      outcome: "idempotencyConflict",
      transactionId: transaction.id,
      idempotentReplay: false,
    };
  }
  switch (transaction.status) {
    case TransactionStatus.PROCESSED:
      return { ...base, outcome: "processed", balance: requireBalance(state.resultingBalance) };
    case TransactionStatus.PENDING_REFERENCE:
      return { ...base, outcome: "pendingReference" };
    case TransactionStatus.REJECTED:
    case TransactionStatus.FAILED:
      return {
        ...base,
        outcome: "rejected",
        failureCode: requireFailureCode(transaction),
        balance: state.resultingBalance,
      };
    case TransactionStatus.PENDING:
      throw new InvariantViolationError("a PENDING transaction is never committed");
  }
}

function requireBalance(balance: Money | null): Money {
  if (balance === null)
    throw new InvariantViolationError("processed transaction without resulting balance");
  return balance;
}

function requireFailureCode(transaction: WagerTransaction): FailureCode {
  if (transaction.failureCode === null) {
    throw new InvariantViolationError("rejected transaction without failure code");
  }
  return transaction.failureCode;
}
