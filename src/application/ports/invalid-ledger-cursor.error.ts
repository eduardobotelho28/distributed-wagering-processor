export class InvalidLedgerCursorError extends Error {
  constructor() {
    super("invalid ledger cursor");
    this.name = "InvalidLedgerCursorError";
  }
}
