import { requireObject } from "../../validation/field-readers";
import {
  readIdempotencyKeyValue,
  readSubmission,
  type SubmitTransactionRequest,
} from "../../validation/wager-submission";

export type { SubmitTransactionRequest };

export function readIdempotencyKey(header: unknown): string {
  const value = Array.isArray(header) ? header[0] : header;
  return readIdempotencyKeyValue(value, "IDEMPOTENCY_KEY_REQUIRED");
}

// DECISION: o header Idempotency-Key é a fonte da verdade (README); não é derivado do corpo.
export function parseSubmitTransactionRequest(
  body: unknown,
  idempotencyKeyHeader: unknown,
): SubmitTransactionRequest {
  const idempotencyKey = readIdempotencyKey(idempotencyKeyHeader);
  return readSubmission(requireObject(body, "body"), idempotencyKey);
}
