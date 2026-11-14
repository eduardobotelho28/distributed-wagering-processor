// DECISION: UUID v7 (ordenável pelo tempo) em vez de v4; inserts caem no fim do índice da PK
// e ids gerados em sequência mantêm a ordem de criação.
export interface IdGenerator {
  next(): string;
}
