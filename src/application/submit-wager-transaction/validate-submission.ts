import { FailureCode } from "../../domain/errors/failure-code";
import { TransactionKind } from "../../domain/transaction/transaction-kind";
import type { InvalidPayloadReason, InvalidPayloadSubmitResult } from "../ports/submit-result";
import type { SubmitWagerTransactionInput } from "./submit-wager-transaction.use-case";

const REQUIRES_REFERENCE: ReadonlySet<TransactionKind> = new Set([
  TransactionKind.REFUND,
  TransactionKind.ROLLBACK,
]);

function invalid(reason: InvalidPayloadReason): InvalidPayloadSubmitResult {
  return { outcome: "invalidPayload", reason };
}

function hasBlankField(input: SubmitWagerTransactionInput): boolean {
  const fields = [
    input.idempotencyKey,
    input.providerId,
    input.externalTransactionId,
    input.playerId,
    input.walletId,
    input.roundId,
    input.gameId,
    input.context.correlationId,
  ];
  return fields.some((field) => field.trim() === "");
}

// DECISION: validação antes de abrir a transação e sem gravar nada. Um payload que nem forma
// uma transação válida não tem estado a auditar; o provedor precisa corrigir e reenviar.
// INVARIANT: OPENING nunca vem de HTTP/SQS; também barrado por WagerTransaction.create.
// INVARIANT: REFUND/ROLLBACK sem referência também é barrado pelo CHECK
// wager_transactions_reversal_reference_check, por isso não pode virar REJECTED gravado.
export function validateSubmission(
  input: SubmitWagerTransactionInput,
): InvalidPayloadSubmitResult | null {
  if (input.kind === TransactionKind.OPENING) return invalid("OPENING_NOT_ALLOWED");
  if (hasBlankField(input)) return invalid("BLANK_FIELD");
  if (REQUIRES_REFERENCE.has(input.kind) && !input.referenceExternalTransactionId?.trim()) {
    return invalid(FailureCode.REFERENCE_REQUIRED);
  }
  // DECISION: LOSS pode ter valor zero (rodada sem aposta registrada); os demais movem saldo e
  // um lançamento de valor zero violaria o CHECK amount > 0 do ledger.
  if (input.kind !== TransactionKind.LOSS && !input.money.isPositive()) {
    return invalid("AMOUNT_NOT_POSITIVE");
  }
  return null;
}
