import { FailureCode } from "../../domain/errors/failure-code";
import { InvalidTransactionStateError } from "../../domain/errors/invalid-transaction-state.error";
import { InvariantViolationError } from "../../domain/errors/invariant-violation.error";
import { CurrencyMismatchError } from "../../domain/money/currency-mismatch.error";
import { InvalidMoneyError } from "../../domain/money/invalid-money.error";
import type { Money } from "../../domain/money/money";
import { computePayloadHash } from "../../domain/transaction/payload-hash";
import type { TransactionKind } from "../../domain/transaction/transaction-kind";
import { TransactionStatus } from "../../domain/transaction/transaction-status";
import { WagerTransaction } from "../../domain/transaction/wager-transaction";
import { InsufficientFundsError } from "../../domain/wallet/insufficient-funds.error";
import type { Clock } from "../ports/clock";
import { DuplicateIdempotencyKeyError } from "../ports/duplicate-idempotency-key.error";
import type { EventContext } from "../ports/event-context";
import type { IdGenerator } from "../ports/id-generator";
import type {
  StoredWagerTransaction,
  WagerTransactionPersistenceState,
} from "../ports/repositories";
import type { RecordedSubmitResult } from "../ports/submit-result";
import type { TransactionalRepositories, UnitOfWork } from "../ports/unit-of-work";
import { nextPendingAttemptAt } from "./pending-reference-policy";
import { SubmissionEvents } from "./submission-events";
import {
  processTransaction,
  rejectTransaction,
  requireReferenceExternalId,
  settled,
} from "./transaction-processor";

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

// DECISION: o corpo da submissão recebe os repositórios da transação corrente em vez de abrir
// a própria. HTTP roda só ele; o consumidor SQS envolve o mesmo corpo com o inbox, na MESMA
// transação SQL (T72). Os dois canais executam exatamente a mesma lógica.
export class WagerSubmission {
  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  // DECISION: lock da carteira ANTES da busca pela idempotency key. Duas entregas da mesma
  // key para a mesma carteira serializam no lock; a segunda só procura a key depois que a
  // primeira commitou, então enxerga a transação gravada e vira replay em vez de duplicar.
  // Buscar antes do lock abriria a janela "ambas não acham, ambas processam".
  async submit(
    repositories: TransactionalRepositories,
    input: SubmitWagerTransactionInput,
  ): Promise<RecordedSubmitResult> {
    const wallet = await repositories.wallets.findByIdForUpdate(input.walletId);
    const payloadHash = computePayloadHash(input);
    const existing = await repositories.transactions.findByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) return replayOrConflict(existing, payloadHash);
    const now = this.clock.now();
    const transaction = this.buildTransaction(input, payloadHash, now);
    const events = new SubmissionEvents(repositories.outbox, this.ids, input.context, now);
    const save = (stored: WagerTransaction, state: WagerTransactionPersistenceState) =>
      repositories.transactions.insert(stored, state);
    if (wallet === null) {
      return rejectTransaction({ transaction, events, save }, FailureCode.WALLET_NOT_FOUND, null);
    }
    return processTransaction({
      repositories,
      transaction,
      wallet,
      events,
      save,
      onUnresolvedReference: () => pendReference(repositories, transaction, events),
    });
  }

  // DECISION: a mesma key enviada em paralelo para carteiras diferentes não serializa no lock
  // (são linhas distintas). O UNIQUE(idempotency_key) decide: a perdedora tem a transação
  // abortada, então relemos numa transação nova. O Postgres só acusa a violação depois que a
  // vencedora commitou, logo a releitura sempre a encontra.
  async resolveKeyRace(
    repositories: TransactionalRepositories,
    input: SubmitWagerTransactionInput,
    error: DuplicateIdempotencyKeyError,
  ): Promise<RecordedSubmitResult> {
    const existing = await repositories.transactions.findByIdempotencyKey(input.idempotencyKey);
    if (existing === null) throw error;
    return replayOrConflict(existing, computePayloadHash(input));
  }

  // DECISION: erro de domínio no meio do processamento é bug determinístico; repetir daria o
  // mesmo erro. A transação original foi desfeita, então gravamos FAILED numa transação nova
  // para o provedor receber resposta terminal e o replay ser estável. Erros de driver/conexão
  // não entram aqui: são transitórios e sobem para quem chamou tentar de novo.
  async recordFailure(
    repositories: TransactionalRepositories,
    input: SubmitWagerTransactionInput,
  ): Promise<RecordedSubmitResult> {
    const payloadHash = computePayloadHash(input);
    const existing = await repositories.transactions.findByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) return replayOrConflict(existing, payloadHash);
    const now = this.clock.now();
    const transaction = this.buildTransaction(input, payloadHash, now);
    const events = new SubmissionEvents(repositories.outbox, this.ids, input.context, now);
    const failureCode = FailureCode.INTERNAL_PERMANENT_ERROR;
    transaction.fail(failureCode);
    await repositories.transactions.insert(transaction, settled(null));
    await events.rejected(transaction, failureCode);
    return failed(transaction.id, failureCode, false);
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
}

export type SubmissionStep = (
  repositories: TransactionalRepositories,
) => Promise<RecordedSubmitResult>;

// Envolve cada passo dentro da transação; o consumidor usa para inserir/marcar o inbox.
export type StepWrapper<TResult> = (
  repositories: TransactionalRepositories,
  step: () => Promise<RecordedSubmitResult>,
) => Promise<TResult>;

// INVARIANT: cada tentativa (submit, releitura da corrida, registro de FAILED) é UMA transação
// SQL com o wrapper dentro dela; o que o wrapper grava some junto se o passo falhar.
export async function runWithRecovery<TResult>(
  unitOfWork: UnitOfWork,
  submission: WagerSubmission,
  input: SubmitWagerTransactionInput,
  wrap: StepWrapper<TResult>,
): Promise<TResult> {
  const run = (step: SubmissionStep) =>
    unitOfWork.run((repositories) => wrap(repositories, () => step(repositories)));
  try {
    return await run((repositories) => submission.submit(repositories, input));
  } catch (error) {
    if (error instanceof DuplicateIdempotencyKeyError) {
      return run((repositories) => submission.resolveKeyRace(repositories, input, error));
    }
    if (isPermanentFailure(error)) {
      return run((repositories) => submission.recordFailure(repositories, input));
    }
    throw error;
  }
}

async function pendReference(
  repositories: TransactionalRepositories,
  transaction: WagerTransaction,
  events: SubmissionEvents,
): Promise<RecordedSubmitResult> {
  transaction.markPendingReference();
  await repositories.transactions.insert(transaction, {
    resultingBalance: null,
    pendingAttempts: 0,
    nextAttemptAt: nextPendingAttemptAt(0, events.now),
  });
  await events.pendingReference(transaction, requireReferenceExternalId(transaction));
  return { outcome: "pendingReference", transactionId: transaction.id, idempotentReplay: false };
}

// DECISION: o replay responde com o saldo gravado em resulting_balance no momento do
// processamento, não com o saldo atual; a mesma requisição recebe sempre a mesma resposta.
function replayOrConflict(
  existing: StoredWagerTransaction,
  payloadHash: string,
): RecordedSubmitResult {
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
    case TransactionStatus.FAILED:
      return failed(transaction.id, requireFailureCode(transaction), true);
    case TransactionStatus.REJECTED:
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

function failed(
  transactionId: string,
  failureCode: FailureCode,
  idempotentReplay: boolean,
): RecordedSubmitResult {
  return { outcome: "failed", transactionId, failureCode, idempotentReplay };
}

const PERMANENT_ERRORS = [
  InvariantViolationError,
  InvalidTransactionStateError,
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidMoneyError,
];

function isPermanentFailure(error: unknown): boolean {
  return PERMANENT_ERRORS.some((errorClass) => error instanceof errorClass);
}

function requireBalance(balance: Money | null): Money {
  if (balance === null) {
    throw new InvariantViolationError("processed transaction without resulting balance");
  }
  return balance;
}

function requireFailureCode(transaction: WagerTransaction): FailureCode {
  if (transaction.failureCode === null) {
    throw new InvariantViolationError("rejected transaction without failure code");
  }
  return transaction.failureCode;
}
