// DECISION: erro de port; o repositório traduz a violação do UNIQUE(idempotency_key) para
// que o caso de uso resolva a corrida sem conhecer exceções do driver.
export class DuplicateIdempotencyKeyError extends Error {
  constructor(idempotencyKey: string) {
    super(`idempotency key already used: ${idempotencyKey}`);
    this.name = "DuplicateIdempotencyKeyError";
  }
}
