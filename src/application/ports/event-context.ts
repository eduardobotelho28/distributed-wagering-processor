// DECISION: correlationId acompanha a requisição/mensagem de origem de ponta a ponta;
// causationId aponta a mensagem que causou o evento (o messageId do SQS, por exemplo) e é
// nulo quando a origem é uma chamada HTTP sem mensagem anterior.
export interface EventContext {
  correlationId: string;
  causationId: string | null;
}
