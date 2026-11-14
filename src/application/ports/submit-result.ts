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

// DECISION: rejeição de negócio e pendência são resultados, não exceções; HTTP e SQS mapeiam
// cada `outcome` para a sua resposta sem interpretar mensagem de erro.
export type SubmitResult =
  ProcessedSubmitResult | RejectedSubmitResult | PendingReferenceSubmitResult;
