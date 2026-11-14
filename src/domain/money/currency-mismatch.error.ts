export class CurrencyMismatchError extends Error {
  readonly code = "CURRENCY_MISMATCH";

  constructor(expected: string, received: string) {
    super(`Currency mismatch: expected ${expected}, received ${received}`);
    this.name = "CurrencyMismatchError";
  }
}
