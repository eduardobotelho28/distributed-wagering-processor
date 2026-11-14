// DECISION: erro de validação neutro de transporte. HTTP traduz para 400 (filtro global) e o
// consumidor SQS para falha permanente (DLQ); os leitores de campo são os mesmos nos dois.
// INVARIANT: a mensagem cita só o nome do campo, nunca o valor recebido.
export class PayloadValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PayloadValidationError";
  }
}
