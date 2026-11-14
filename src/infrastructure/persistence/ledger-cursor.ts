import { InvalidLedgerCursorError } from "../../application/ports/invalid-ledger-cursor.error";

export interface LedgerCursor {
  createdAt: Date;
  id: string;
}

const SEPARATOR = "|";
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// DECISION: cursor opaco = base64url de "createdAt|id". A chave composta é estável mesmo com
// lançamentos no mesmo instante; o cliente não depende do formato interno.
// RISK: o cursor guarda milissegundos. Lançamentos sempre recebem o instante do domínio
// (Date em ms); um created_at com microssegundos gravado fora da aplicação poderia ser pulado.
export function encodeLedgerCursor(cursor: LedgerCursor): string {
  const raw = `${cursor.createdAt.toISOString()}${SEPARATOR}${cursor.id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export function decodeLedgerCursor(encoded: string): LedgerCursor {
  const [instant, id, ...rest] = Buffer.from(encoded, "base64url")
    .toString("utf8")
    .split(SEPARATOR);
  if (instant === undefined || id === undefined || id === "" || rest.length > 0) {
    throw new InvalidLedgerCursorError();
  }
  if (!ISO_INSTANT.test(instant)) throw new InvalidLedgerCursorError();
  return { createdAt: new Date(instant), id };
}
