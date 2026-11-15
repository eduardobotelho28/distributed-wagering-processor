import { readText, requireObject } from "../validation/field-readers";
import { PayloadValidationError } from "../validation/payload-validation.error";
import {
  readIdempotencyKeyValue,
  readSubmission,
  type SubmitTransactionRequest,
} from "../validation/wager-submission";

export const WAGER_MESSAGE_TYPE = "WagerTransactionRequested";

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export interface WagerMessage {
  messageId: string;
  occurredAt: Date;
  request: SubmitTransactionRequest;
}

// DECISION: falha de parse é resultado, não exceção. Toda falha aqui é PERMANENTE: a mesma
// mensagem reentregue falha igual, então o consumidor a manda para a DLQ.
// messageId vem junto quando foi possível lê-lo, para o log/DLQ identificar a mensagem.
export type ParsedWagerMessage =
  | { ok: true; message: WagerMessage }
  | { ok: false; permanent: true; code: string; reason: string; messageId: string | null };

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new PayloadValidationError("INVALID_JSON", "message body is not valid JSON");
  }
}

function readOccurredAt(envelope: Record<string, unknown>): Date {
  const value = envelope.occurredAt;
  if (typeof value !== "string" || !ISO_INSTANT.test(value) || !Date.parse(value)) {
    throw new PayloadValidationError("INVALID_FIELD", "occurredAt must be an ISO-8601 UTC instant");
  }
  return new Date(value);
}

function readMessageId(envelope: unknown): string | null {
  if (typeof envelope !== "object" || envelope === null) return null;
  const value = Object.entries(envelope).find(([key]) => key === "messageId")?.[1];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readMessage(envelope: unknown): WagerMessage {
  const source = requireObject(envelope, "message");
  const messageId = readText(source, "messageId");
  if (source.type !== WAGER_MESSAGE_TYPE) {
    throw new PayloadValidationError(
      "UNSUPPORTED_MESSAGE_TYPE",
      `type must be ${WAGER_MESSAGE_TYPE}`,
    );
  }
  const occurredAt = readOccurredAt(source);
  const data = requireObject(source.data, "data");
  // INVARIANT: na fila, a idempotency key vem da mensagem (data.idempotencyKey), não de header.
  const idempotencyKey = readIdempotencyKeyValue(data.idempotencyKey, "IDEMPOTENCY_KEY_REQUIRED");
  return { messageId, occurredAt, request: readSubmission(data, idempotencyKey) };
}

export function parseWagerMessage(body: string): ParsedWagerMessage {
  let envelope: unknown = null;
  try {
    envelope = parseJson(body);
    return { ok: true, message: readMessage(envelope) };
  } catch (error) {
    if (!(error instanceof PayloadValidationError)) throw error;
    return {
      ok: false,
      permanent: true,
      code: error.code,
      reason: error.message,
      messageId: readMessageId(envelope),
    };
  }
}
