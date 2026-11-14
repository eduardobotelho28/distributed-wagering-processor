import { FailureCode } from "../errors/failure-code";

// DECISION: erro de domínio com FailureCode estável; o caso de uso converte em rejeição
// de negócio (REFERENCE_REQUIRED), nunca vaza como exceção ao cliente.
export class ReferenceRequiredError extends Error {
  readonly code = FailureCode.REFERENCE_REQUIRED;

  constructor(kind: string) {
    super(`Transaction kind ${kind} requires a reference`);
    this.name = "ReferenceRequiredError";
  }
}
