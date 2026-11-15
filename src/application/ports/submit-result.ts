import type { FailureCode } from "../../domain/errors/failure-code";
import type { Money } from "../../domain/money/money";

interface SubmitResultBase {
  transactionId: string;
  // INVARIANT: true só quando a resposta veio de uma transação já gravada com o mesmo
  // idempotency key e o mesmo payload hash; o estado não foi alterado nesta chamada.
  idempotentReplay: boolean;
}

export interface ProcessedSubmitResult extends SubmitResultBase {
  outcome: "processed";
  balance: Money;
}

export interface RejectedSubmitResult extends SubmitResultBase {
  outcome: "rejected";
  failureCode: FailureCode;
  balance: Money | null;
}

export interface PendingReferenceSubmitResult extends SubmitResultBase {
  outcome: "pendingReference";
}

// DECISION: FAILED é erro interno permanente (bug determinístico), separado da rejeição de
// negócio: o provedor não deve corrigir o payload, e sim acionar suporte.
export interface FailedSubmitResult extends SubmitResultBase {
  outcome: "failed";
  failureCode: FailureCode;
}

export type InvalidPayloadReason =
  FailureCode.REFERENCE_REQUIRED | "OPENING_NOT_ALLOWED" | "AMOUNT_NOT_POSITIVE" | "BLANK_FIELD";

// DECISION: payload inválido não grava nada, então não há transactionId nem replay.
export interface InvalidPayloadSubmitResult {
  outcome: "invalidPayload";
  reason: InvalidPayloadReason;
}

// DECISION: mesma key com payload diferente não é replay nem rejeição de negócio; é erro do
// cliente e não grava nada. transactionId aponta a transação original daquela key.
export interface IdempotencyConflictSubmitResult extends SubmitResultBase {
  outcome: "idempotencyConflict";
}

// DECISION: o mesmo (providerId, externalTransactionId) com OUTRA idempotency key também é
// conflito, não replay: a key é a fonte da verdade do replay, e duas keys para a mesma operação
// do provedor indicam erro do cliente. transactionId aponta a transação já gravada.
export interface ExternalIdConflictSubmitResult extends SubmitResultBase {
  outcome: "externalIdConflict";
}

// DECISION: rejeição de negócio e pendência são resultados, não exceções; HTTP e SQS mapeiam
// cada `outcome` para a sua resposta sem interpretar mensagem de erro.
// Resultados que correspondem a uma transação gravada (ou já existente para a key).
export type RecordedSubmitResult =
  | ProcessedSubmitResult
  | RejectedSubmitResult
  | PendingReferenceSubmitResult
  | IdempotencyConflictSubmitResult
  | ExternalIdConflictSubmitResult
  | FailedSubmitResult;

export type SubmitResult = RecordedSubmitResult | InvalidPayloadSubmitResult;
