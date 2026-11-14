// isto é um erro de programação (exceção), não rejeição de negócio. Uma transição inválida
// indica bug no fluxo; rejeições de negócio viram resultado com FailureCode.
export class InvalidTransactionStateError extends Error {
  readonly code = "INVALID_TRANSACTION_STATE";

  constructor(from: string, action: string) {
    super(`Invalid transaction transition: cannot ${action} from ${from}`);
    this.name = "InvalidTransactionStateError";
  }
}
