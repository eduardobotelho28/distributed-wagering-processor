import { FailureCode } from "../errors/failure-code";
import { TransactionKind } from "./transaction-kind";
import { TransactionStatus } from "./transaction-status";
import type { WagerTransaction } from "./wager-transaction";

export type ReversalVerdict = { ok: true } | { ok: false; failureCode: FailureCode };

const REVERSIBLE_KINDS: ReadonlyMap<TransactionKind, ReadonlySet<TransactionKind>> = new Map([
  [TransactionKind.REFUND, new Set([TransactionKind.BET])],
  [
    TransactionKind.ROLLBACK,
    new Set([TransactionKind.BET, TransactionKind.WIN, TransactionKind.REFUND]),
  ],
]);

const OK: ReversalVerdict = { ok: true };

// DECISION: checks run in a fixed order (kind, status, ownership, currency, amount) so the
// provider always gets the most structural failure first and the result is deterministic.
// RISK: "already reversed" needs a DB lookup and is checked by the use case, not here.
export function checkReversal(
  reversal: WagerTransaction,
  reference: WagerTransaction,
): ReversalVerdict {
  if (!REVERSIBLE_KINDS.get(reversal.kind)?.has(reference.kind)) {
    return reject(FailureCode.INVALID_REFERENCE_KIND);
  }
  if (reference.status !== TransactionStatus.PROCESSED) {
    return reject(FailureCode.REFERENCE_NOT_PROCESSED);
  }
  if (!sameOwnership(reversal, reference)) return reject(FailureCode.REFERENCE_MISMATCH);
  if (reversal.money.currency !== reference.money.currency) {
    return reject(FailureCode.CURRENCY_MISMATCH);
  }
  if (!reversal.money.equals(reference.money)) return reject(FailureCode.AMOUNT_MISMATCH);
  return OK;
}

function sameOwnership(reversal: WagerTransaction, reference: WagerTransaction): boolean {
  return (
    reversal.providerId === reference.providerId &&
    reversal.playerId === reference.playerId &&
    reversal.walletId === reference.walletId &&
    reversal.roundId === reference.roundId
  );
}

function reject(failureCode: FailureCode): ReversalVerdict {
  return { ok: false, failureCode };
}
