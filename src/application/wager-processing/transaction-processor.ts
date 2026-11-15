import { FailureCode } from "../../domain/errors/failure-code";
import { InvariantViolationError } from "../../domain/errors/invariant-violation.error";
import type { Money } from "../../domain/money/money";
import { checkReversal } from "../../domain/transaction/reversal-policy";
import { TransactionStatus } from "../../domain/transaction/transaction-status";
import type { WagerTransaction } from "../../domain/transaction/wager-transaction";
import type { Wallet } from "../../domain/wallet/wallet";
import { LedgerDirection } from "../../domain/wallet/wallet-ledger-entry";
import type { WagerTransactionPersistenceState } from "../ports/repositories";
import type { RecordedSubmitResult } from "../ports/submit-result";
import type { TransactionalRepositories } from "../ports/unit-of-work";
import type { SubmissionEvents } from "./submission-events";

// DECISION: processamento compartilhado entre a submissão (transação nova, gravada com
// insert) e o reprocessamento de PENDING_REFERENCE (transação existente, gravada com update).
// Quem chama decide como gravar e o que fazer quando a referência ainda não existe.
export interface ProcessingContext {
  repositories: TransactionalRepositories;
  transaction: WagerTransaction;
  wallet: Wallet;
  events: SubmissionEvents;
  save(transaction: WagerTransaction, state: WagerTransactionPersistenceState): Promise<void>;
  onUnresolvedReference(): Promise<RecordedSubmitResult>;
}

interface Movement {
  direction: LedgerDirection;
  referenceTransactionId: string | null;
  overdraftCode: FailureCode;
}

// INVARIANT: chamado com a carteira já travada (PESSIMISTIC_WRITE) na transação corrente.
export function processTransaction(context: ProcessingContext): Promise<RecordedSubmitResult> {
  const { transaction, wallet } = context;
  // DECISION: dono antes de moeda; um payload para a carteira de outro jogador é o erro mais
  // estrutural. A rejeição é gravada (auditável) e não move saldo.
  if (transaction.playerId !== wallet.playerId) {
    return rejectTransaction(context, FailureCode.PLAYER_MISMATCH, wallet.balance);
  }
  if (transaction.money.currency !== wallet.currency) {
    return rejectTransaction(context, FailureCode.CURRENCY_MISMATCH, wallet.balance);
  }
  if (!transaction.affectsBalance()) return recordWithoutMovement(context);
  if (transaction.requiresReference()) return processReversal(context);
  return applyMovement(context, {
    direction: transaction.ledgerDirectionFor(),
    referenceTransactionId: null,
    overdraftCode: FailureCode.INSUFFICIENT_FUNDS,
  });
}

export async function rejectTransaction(
  context: Pick<ProcessingContext, "transaction" | "events" | "save">,
  failureCode: FailureCode,
  balance: Money | null,
): Promise<RecordedSubmitResult> {
  const { transaction, events } = context;
  transaction.reject(failureCode);
  await context.save(transaction, settled(balance));
  await events.rejected(transaction, failureCode);
  return {
    outcome: "rejected",
    transactionId: transaction.id,
    failureCode,
    balance,
    idempotentReplay: false,
  };
}

// INVARIANT: transação, lançamento e saldo são gravados na mesma transação SQL do lock.
// INVARIANT: débito sem saldo vira REJECTED antes de tocar a carteira; o saldo nunca fica
// negativo (também barrado por Wallet.debit e pelo CHECK balance >= 0).
async function applyMovement(
  context: ProcessingContext,
  movement: Movement,
): Promise<RecordedSubmitResult> {
  const { repositories, transaction, wallet, events } = context;
  const now = events.now;
  if (
    movement.direction === LedgerDirection.DEBIT &&
    wallet.balance.isLessThan(transaction.money)
  ) {
    return rejectTransaction(context, movement.overdraftCode, wallet.balance);
  }
  const entry =
    movement.direction === LedgerDirection.DEBIT
      ? wallet.debit(transaction.money, transaction.id, now)
      : wallet.credit(transaction.money, transaction.id, now);
  transaction.markProcessed(now, movement.referenceTransactionId);
  await context.save(transaction, settled(wallet.balance));
  await repositories.ledger.insert(entry);
  await repositories.wallets.saveBalance(wallet, now);
  await events.processed(transaction, wallet.balance);
  await events.balanceChanged(entry);
  return processed(transaction, wallet.balance);
}

async function processReversal(context: ProcessingContext): Promise<RecordedSubmitResult> {
  const { repositories, transaction, wallet } = context;
  const reference = await repositories.transactions.findByProviderAndExternalId(
    transaction.providerId,
    requireReferenceExternalId(transaction),
  );
  if (reference === null || isUnresolved(reference)) return context.onUnresolvedReference();
  const verdict = checkReversal(transaction, reference);
  if (!verdict.ok) return rejectTransaction(context, verdict.failureCode, wallet.balance);
  // INVARIANT: também garantido pelo índice único parcial
  // wager_transactions_single_reversal_per_reference_idx;
  // esta consulta só transforma a violação em REJECTED auditável.
  if ((await repositories.transactions.findProcessedReversalOf(reference.id)) !== null) {
    return rejectTransaction(context, FailureCode.REFERENCE_ALREADY_REVERSED, wallet.balance);
  }
  return applyMovement(context, {
    direction: transaction.ledgerDirectionFor(reference),
    referenceTransactionId: reference.id,
    overdraftCode: FailureCode.REVERSAL_WOULD_OVERDRAW,
  });
}

// DECISION: LOSS fecha a rodada sem lançamento; o débito já ocorreu no BET. O saldo
// resultante gravado é o atual, para o replay responder o mesmo valor.
async function recordWithoutMovement(context: ProcessingContext): Promise<RecordedSubmitResult> {
  const { transaction, wallet, events } = context;
  transaction.markProcessed(events.now, null);
  await context.save(transaction, settled(wallet.balance));
  await events.processed(transaction, wallet.balance);
  return processed(transaction, wallet.balance);
}

const UNRESOLVED_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  TransactionStatus.PENDING,
  TransactionStatus.PENDING_REFERENCE,
]);

// DECISION: referência ainda pendente é tratada como ausente; reverter algo que não moveu
// saldo seria incorreto, e ela pode se resolver depois.
function isUnresolved(reference: WagerTransaction): boolean {
  return UNRESOLVED_STATUSES.has(reference.status);
}

export function requireReferenceExternalId(transaction: WagerTransaction): string {
  const referenceId = transaction.referenceExternalTransactionId;
  if (referenceId === null) throw new InvariantViolationError("reversal without reference");
  return referenceId;
}

export function settled(resultingBalance: Money | null): WagerTransactionPersistenceState {
  return { resultingBalance, pendingAttempts: 0, nextAttemptAt: null };
}

function processed(transaction: WagerTransaction, balance: Money): RecordedSubmitResult {
  return { outcome: "processed", transactionId: transaction.id, balance, idempotentReplay: false };
}
