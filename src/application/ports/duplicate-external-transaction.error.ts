// DECISION: erro de port; o repositório traduz a violação do UNIQUE(provider_id,
// external_transaction_id) para que o caso de uso responda conflito sem conhecer o driver.
export class DuplicateExternalTransactionError extends Error {
  constructor(providerId: string, externalTransactionId: string) {
    super(`external transaction already recorded: ${providerId}/${externalTransactionId}`);
    this.name = "DuplicateExternalTransactionError";
  }
}
