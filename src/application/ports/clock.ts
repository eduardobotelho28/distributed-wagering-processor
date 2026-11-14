// DECISION: o relógio é injetado para que casos de uso e testes sejam determinísticos.
export interface Clock {
  now(): Date;
}
