import type { LogFields, Logger } from "../../application/ports/logger";

// DECISION: implementação provisória até a T81 (logger JSON com AsyncLocalStorage).
// Uma linha JSON por evento em stderr; só os campos escalares que o chamador escolheu.
export class JsonConsoleLogger implements Logger {
  error(message: string, fields: LogFields): void {
    console.error(
      JSON.stringify({ level: "error", message, ...fields, at: new Date().toISOString() }),
    );
  }
}
