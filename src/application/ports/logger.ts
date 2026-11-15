export type LogFields = Record<string, string | number | boolean>;

// DECISION: o chamador passa só campos escalares escolhidos; a implementação ainda filtra por
// lista de permitidos (JsonLogger). O contexto (correlationId, messageId...) é anexado pela
// implementação, não pelo chamador.
// INVARIANT: nunca recebe o payload inteiro nem valores monetários além do necessário.
export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}
