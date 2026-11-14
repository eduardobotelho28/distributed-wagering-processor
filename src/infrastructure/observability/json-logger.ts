import type { LogFields, Logger } from "../../application/ports/logger";
import { currentLogContext } from "./log-context";

type Level = "info" | "warn" | "error";

// DECISION: lista de campos PERMITIDOS em vez de lista de proibidos. Um campo novo só aparece
// no log depois de entrar aqui conscientemente; esquecer de proibir um payload é impossível.
// INVARIANT: nenhum campo carrega corpo de requisição, mensagem ou envelope de evento.
const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  "correlationId",
  "messageId",
  "transactionId",
  "walletId",
  "providerId",
  "eventId",
  "eventType",
  "worker",
  "error",
  "code",
  "outcome",
  "status",
  "kind",
  "receiveCount",
  "checkedEntries",
  "difference",
  "published",
  "failed",
  "attempted",
  "method",
  "route",
  "statusCode",
  "durationMs",
]);

const MAX_VALUE_LENGTH = 128;

export type LogSink = (line: string) => void;

function clip(value: string | number | boolean): string | number | boolean {
  return typeof value === "string" && value.length > MAX_VALUE_LENGTH
    ? `${value.slice(0, MAX_VALUE_LENGTH)}…`
    : value;
}

export function redact(fields: LogFields): LogFields {
  const kept: LogFields = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED_FIELDS.has(key)) kept[key] = clip(value);
    else dropped += 1;
  }
  if (dropped > 0) kept.redactedFields = dropped;
  return kept;
}

// Uma linha JSON por evento: { level, message, timestamp, ...contexto, ...campos }.
export class JsonLogger implements Logger {
  constructor(
    private readonly sink: LogSink = (line) => process.stdout.write(`${line}\n`),
    private readonly now: () => Date = () => new Date(),
  ) {}

  info(message: string, fields: LogFields = {}): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields: LogFields = {}): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields: LogFields = {}): void {
    this.write("error", message, fields);
  }

  private write(level: Level, message: string, fields: LogFields): void {
    const context: LogFields = {};
    for (const [key, value] of Object.entries(currentLogContext())) {
      if (value !== undefined) context[key] = value;
    }
    const line = {
      level,
      message,
      timestamp: this.now().toISOString(),
      ...redact({ ...context, ...fields }),
    };
    this.sink(JSON.stringify(line));
  }
}
