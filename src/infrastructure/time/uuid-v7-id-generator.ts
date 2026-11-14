import type { IdGenerator } from "../../application/ports/id-generator";

// DECISION: Bun.randomUUIDv7 nativo em vez de uma biblioteca de UUID; sem dependência nova.
export class UuidV7IdGenerator implements IdGenerator {
  next(): string {
    return Bun.randomUUIDv7();
  }
}
