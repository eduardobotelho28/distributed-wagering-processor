import { Money } from "../../../domain/money/money";
import { InvalidMoneyError } from "../../../domain/money/invalid-money.error";
import { ApiError } from "../errors/api-error";

export type JsonObject = Record<string, unknown>;

// INVARIANT: mesmo limite das colunas varchar(255); um texto maior estouraria no banco como 500.
const MAX_TEXT_LENGTH = 255;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DECISION: mensagens citam só o nome do campo, nunca o valor recebido (pode ser dado sensível).
export function requireObject(value: unknown, name: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw ApiError.invalidPayload("INVALID_PAYLOAD", `${name} must be a JSON object`);
  }
  return Object.fromEntries(Object.entries(value));
}

export function readText(source: JsonObject, field: string): string {
  const value = source[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw ApiError.invalidPayload("INVALID_FIELD", `${field} must be a non-empty string`);
  }
  if (value.length > MAX_TEXT_LENGTH) {
    throw ApiError.invalidPayload("INVALID_FIELD", `${field} exceeds ${MAX_TEXT_LENGTH} chars`);
  }
  return value;
}

export function readOptionalText(source: JsonObject, field: string): string | null {
  if (source[field] === undefined || source[field] === null) return null;
  return readText(source, field);
}

export function readUuid(source: JsonObject, field: string): string {
  const value = readText(source, field);
  if (!UUID_PATTERN.test(value)) {
    throw ApiError.invalidPayload("INVALID_FIELD", `${field} must be a UUID`);
  }
  return value.toLowerCase();
}

// INVARIANT: amount chega como string decimal; número JSON é rejeitado pelo próprio Money.
export function readMoney(source: JsonObject, field: string): Money {
  const money = requireObject(source[field], field);
  try {
    return Money.from({ amount: money.amount, currency: money.currency });
  } catch (error) {
    if (!(error instanceof InvalidMoneyError)) throw error;
    throw ApiError.invalidPayload(
      "INVALID_MONEY",
      `${field} must be { amount: decimal string with up to 2 places, currency: 3 letters }`,
    );
  }
}

export function readEnum<T extends string>(
  source: JsonObject,
  field: string,
  allowed: readonly T[],
): T {
  const value = source[field];
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw ApiError.invalidPayload(
      `INVALID_${field.toUpperCase()}`,
      `${field} must be one of ${allowed.join(", ")}`,
    );
  }
  return match;
}
