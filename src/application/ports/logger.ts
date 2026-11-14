export type LogFields = Record<string, string | number | boolean>;

// DECISION: port mínimo; a implementação JSON com contexto assíncrono chega na T81.
// INVARIANT: campos são escalares escolhidos por quem loga; nunca o payload inteiro.
export interface Logger {
  error(message: string, fields: LogFields): void;
}
