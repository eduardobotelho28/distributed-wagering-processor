import { readOptionalText, readUuid } from "../../validation/field-readers";
import { PayloadValidationError } from "../../validation/payload-validation.error";

// DECISION: id malformado na URL é 400, não 404; a coluna é uuid e o cliente precisa saber
// que errou o formato, não que o recurso sumiu.
export function readPathUuid(value: unknown, name: string): string {
  return readUuid({ [name]: value }, name);
}

export const LEDGER_DEFAULT_LIMIT = 50;
const DIGITS = /^\d{1,4}$/;

// DECISION: o limite só é convertido de texto para inteiro aqui; o teto (200) é regra do caso
// de uso, que devolve invalidLimit.
export function readLimit(value: unknown): number {
  if (value === undefined) return LEDGER_DEFAULT_LIMIT;
  if (typeof value !== "string" || !DIGITS.test(value)) {
    throw new PayloadValidationError("INVALID_LIMIT", "limit must be a positive integer");
  }
  return Number.parseInt(value, 10);
}

export function readCursor(value: unknown): string | null {
  if (value === undefined) return null;
  return readOptionalText({ cursor: value }, "cursor");
}

const CORRELATION_ID = /^[\w.:-]{1,128}$/;

// DECISION: correlationId do header só é aceito com formato seguro para log; caso contrário
// geramos um, em vez de rejeitar a requisição por um header de rastreio.
export function readCorrelationId(value: unknown, generate: () => string): string {
  return typeof value === "string" && CORRELATION_ID.test(value) ? value : generate();
}
