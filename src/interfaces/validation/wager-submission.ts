import type { SubmitWagerTransactionInput } from "../../application/submit-wager-transaction/submit-wager-transaction.use-case";
import { TransactionKind } from "../../domain/transaction/transaction-kind";
import {
  type JsonObject,
  readEnum,
  readMoney,
  readOptionalText,
  readText,
  readUuid,
} from "./field-readers";
import { PayloadValidationError } from "./payload-validation.error";

export type SubmitTransactionRequest = Omit<SubmitWagerTransactionInput, "context">;

// INVARIANT: OPENING fica fora da lista; nunca entra por HTTP nem SQS. O caso de uso barra de
// novo (validateSubmission) e o domínio também (WagerTransaction.create).
const EXTERNAL_KINDS: readonly TransactionKind[] = [
  TransactionKind.BET,
  TransactionKind.WIN,
  TransactionKind.LOSS,
  TransactionKind.REFUND,
  TransactionKind.ROLLBACK,
];

const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export function readIdempotencyKeyValue(value: unknown, missingCode: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PayloadValidationError(missingCode, "idempotency key is required");
  }
  if (value.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new PayloadValidationError("INVALID_IDEMPOTENCY_KEY", "idempotency key is too long");
  }
  return value;
}

function readKind(source: JsonObject): TransactionKind {
  if (source.kind === TransactionKind.OPENING) {
    throw new PayloadValidationError("OPENING_NOT_ALLOWED", "OPENING is internal only");
  }
  return readEnum(source, "kind", EXTERNAL_KINDS);
}

// DECISION: mesmos campos de negócio em HTTP e SQS; só a origem da idempotency key muda
// (header no HTTP, campo `data.idempotencyKey` na mensagem).
export function readSubmission(
  source: JsonObject,
  idempotencyKey: string,
): SubmitTransactionRequest {
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
