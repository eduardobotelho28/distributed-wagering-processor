import type { SubmitResult } from "../../../application/ports/submit-result";
import type { MoneyJSON } from "../../../domain/money/money";
import { TransactionStatus } from "../../../domain/transaction/transaction-status";
import { ApiError } from "../errors/api-error";
import { HttpStatus, type HttpStatusCode } from "../errors/http-status-table";

export interface TransactionReplyBody {
  transactionId: string;
  status: TransactionStatus;
  balance: MoneyJSON | null;
  idempotentReplay: boolean;
}

export interface RejectedReplyBody extends TransactionReplyBody {
  code: string;
  message: string;
  retryable: false;
}

export interface HttpReply<TBody> {
  status: HttpStatusCode;
  body: TBody;
}

// DECISION: rejeição (422) e FAILED (500) carregam o corpo da transação E o formato de erro
// { code, message, retryable }; o provedor guarda o transactionId e decide pelo `retryable`.
// DECISION: processado responde 201 na primeira vez e 200 no replay; o corpo é idêntico
// exceto por idempotentReplay, então o provedor pode tratar os dois como sucesso.
export function submitResultToHttp(
  result: SubmitResult,
): HttpReply<TransactionReplyBody | RejectedReplyBody> {
  switch (result.outcome) {
    case "processed":
      return {
        status: result.idempotentReplay ? HttpStatus.OK : HttpStatus.CREATED,
        body: transactionBody(result, TransactionStatus.PROCESSED, result.balance.toJSON()),
      };
    case "pendingReference":
      return {
        status: HttpStatus.ACCEPTED,
        body: transactionBody(result, TransactionStatus.PENDING_REFERENCE, null),
      };
    case "rejected":
      return {
        status: HttpStatus.UNPROCESSABLE,
        body: {
          ...transactionBody(result, TransactionStatus.REJECTED, result.balance?.toJSON() ?? null),
          ...errorFields(result.failureCode, "transaction rejected by business rule"),
        },
      };
    case "failed":
      return {
        status: HttpStatus.INTERNAL,
        body: {
          ...transactionBody(result, TransactionStatus.FAILED, null),
          ...errorFields(result.failureCode, "transaction failed permanently, contact support"),
        },
      };
    case "idempotencyConflict":
      throw new ApiError(
        HttpStatus.CONFLICT,
        "IDEMPOTENCY_CONFLICT",
        `idempotency key already used with a different payload by ${result.transactionId}`,
      );
    case "invalidPayload":
      throw ApiError.invalidPayload(result.reason, "invalid transaction payload");
  }
}

function transactionBody(
  result: { transactionId: string; idempotentReplay: boolean },
  status: TransactionStatus,
  balance: MoneyJSON | null,
): TransactionReplyBody {
  return {
    transactionId: result.transactionId,
    status,
    balance,
    idempotentReplay: result.idempotentReplay,
  };
}

function errorFields(
  code: string,
  message: string,
): Pick<RejectedReplyBody, "code" | "message" | "retryable"> {
  return { code, message, retryable: false };
}
