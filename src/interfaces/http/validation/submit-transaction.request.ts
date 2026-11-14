import type { SubmitWagerTransactionInput } from "../../../application/submit-wager-transaction/submit-wager-transaction.use-case";
import { TransactionKind } from "../../../domain/transaction/transaction-kind";
import { ApiError } from "../errors/api-error";
import {
  readEnum,
  readMoney,
  readOptionalText,
  readText,
  readUuid,
  requireObject,
} from "./field-readers";

export type SubmitTransactionRequest = Omit<SubmitWagerTransactionInput, "context">;

// INVARIANT: OPENING fica fora da lista; nunca entra por HTTP. O caso de uso barra de novo
// (validateSubmission) e o domínio também (WagerTransaction.create).
const EXTERNAL_KINDS: readonly TransactionKind[] = [
  TransactionKind.BET,
  TransactionKind.WIN,
  TransactionKind.LOSS,
  TransactionKind.REFUND,
  TransactionKind.ROLLBACK,
];

const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export function readIdempotencyKey(header: unknown): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string" || value.trim() === "") {
    throw ApiError.invalidPayload("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
  }
  if (value.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw ApiError.invalidPayload("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key is too long");
  }
  return value;
}

function readKind(source: Record<string, unknown>): TransactionKind {
  if (source.kind === TransactionKind.OPENING) {
    throw ApiError.invalidPayload("OPENING_NOT_ALLOWED", "OPENING is internal only");
  }
  return readEnum(source, "kind", EXTERNAL_KINDS);
}

// DECISION: o header Idempotency-Key é a fonte da verdade (README); não é derivado do corpo.
export function parseSubmitTransactionRequest(
  body: unknown,
  idempotencyKeyHeader: unknown,
): SubmitTransactionRequest {
  const idempotencyKey = readIdempotencyKey(idempotencyKeyHeader);
  const source = requireObject(body, "body");
  return {
    idempotencyKey,
    providerId: readText(source, "providerId"),
    externalTransactionId: readText(source, "externalTransactionId"),
    playerId: readText(source, "playerId"),
    walletId: readUuid(source, "walletId"),
    roundId: readText(source, "roundId"),
    gameId: readText(source, "gameId"),
    kind: readKind(source),
    money: readMoney(source, "money"),
    referenceExternalTransactionId: readOptionalText(source, "referenceExternalTransactionId"),
  };
}
