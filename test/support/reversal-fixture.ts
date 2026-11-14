import type { RecordedSubmitResult } from "../../src/application/ports/submit-result";
import type { TransactionKind } from "../../src/domain/transaction/transaction-kind";
import { brl, type SubmitFixture } from "./submit-fixture";

export async function submitReference(
  fixture: SubmitFixture,
  kind: TransactionKind,
  amount: string,
  externalTransactionId = `ref-${crypto.randomUUID()}`,
): Promise<{ result: RecordedSubmitResult; externalTransactionId: string }> {
  const result = await fixture.useCase.execute(
    fixture.input({ kind, money: brl(amount), externalTransactionId }),
  );
  return { result, externalTransactionId };
}

export function submitReversal(
  fixture: SubmitFixture,
  kind: TransactionKind,
  referenceExternalTransactionId: string,
  amount: string,
): Promise<RecordedSubmitResult> {
  return fixture.useCase.execute(
    fixture.input({ kind, money: brl(amount), referenceExternalTransactionId }),
  );
}
