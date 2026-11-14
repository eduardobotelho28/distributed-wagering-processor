export class InvariantViolationError extends Error {
  readonly code = "INVARIANT_VIOLATION";

  constructor(invariant: string) {
    super(`Invariant violated: ${invariant}`);
    this.name = "InvariantViolationError";
  }
}
