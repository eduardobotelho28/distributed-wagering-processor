import { FailureCode } from "../errors/failure-code";

// DECISION: erro de domínio com FailureCode estável; o caso de uso captura e converte em
// rejeição de negócio (REJECTED + INSUFFICIENT_FUNDS), nunca vaza como exceção ao cliente.
export class InsufficientFundsError extends Error {
  readonly code = FailureCode.INSUFFICIENT_FUNDS;

  constructor(walletId: string) {
    super(`Insufficient funds in wallet ${walletId}`);
    this.name = "InsufficientFundsError";
  }
}
