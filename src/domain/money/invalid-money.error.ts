export class InvalidMoneyError extends Error {
  readonly code = "INVALID_MONEY";

  constructor(reason: string) {
    super(`Invalid money: ${reason}`);
    this.name = "InvalidMoneyError";
  }
}
