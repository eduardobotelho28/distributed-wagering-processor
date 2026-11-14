import { createHash } from "node:crypto";
import type { Money } from "../money/money";
import type { TransactionKind } from "./transaction-kind";

export interface PayloadHashInput {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: TransactionKind;
  money: Money;
}

type CanonicalValue = string | { [key: string]: CanonicalValue };

// DECISION: payload hash algorithm.
// 1. Pick ONLY the business fields listed in PayloadHashInput; headers, SQS attributes
//    and any extra transport field are dropped, so redeliveries hash identically.
// 2. Money becomes its decimal-string JSON ({ amount: "10.00", currency }), never a number.
// 3. Serialize as canonical JSON: keys sorted by code point at every level, no whitespace.
// 4. sha256 over the UTF-8 bytes, lowercase hex.
// INVARIANT: same business payload => same hash regardless of key order (payload-hash.test.ts).
export function computePayloadHash(input: PayloadHashInput): string {
  const business: CanonicalValue = {
    providerId: input.providerId,
    externalTransactionId: input.externalTransactionId,
    playerId: input.playerId,
    walletId: input.walletId,
    roundId: input.roundId,
    gameId: input.gameId,
    kind: input.kind,
    money: { ...input.money.toJSON() },
  };
  return createHash("sha256").update(canonicalJson(business), "utf8").digest("hex");
}

function canonicalJson(value: CanonicalValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? "")}`);
  return `{${members.join(",")}}`;
}
