import {
  ConnectionException,
  DeadlockException,
  DriverException,
  LockWaitTimeoutException,
} from "@mikro-orm/postgresql";

// SQLSTATE: 55P03 lock indisponível (lock_timeout), 08xxx conexão, 40001 serialização, 40P01 deadlock, 53xxx recursos (conexões
// esgotadas), 57P0x servidor reiniciando/desligando.
// 55P03 lock_not_available: o lock_timeout da transação estourou numa carteira disputada.
const TRANSIENT_SQLSTATE_PREFIXES = ["08", "40001", "40P01", "53", "55P03", "57P0"];

// DECISION: transitório = repetir a mesma requisição pode dar certo sem o cliente mudar nada.
// Violações de constraint, erros de sintaxe e de domínio são permanentes e não entram aqui.
export function isTransientDatabaseError(error: unknown): boolean {
  if (
    error instanceof ConnectionException ||
    error instanceof DeadlockException ||
    error instanceof LockWaitTimeoutException
  ) {
    return true;
  }
  if (!(error instanceof DriverException)) return false;
  const sqlState = error.sqlState ?? error.code ?? "";
  return TRANSIENT_SQLSTATE_PREFIXES.some((prefix) => sqlState.startsWith(prefix));
}

export type LockConflictKind = "deadlock" | "lock_timeout" | "serialization";

// Classifica conflitos de lock para a métrica lock_conflicts_total; null = não é conflito.
export function lockConflictKind(error: unknown): LockConflictKind | null {
  if (error instanceof DeadlockException) return "deadlock";
  if (error instanceof LockWaitTimeoutException) return "lock_timeout";
  if (!(error instanceof DriverException)) return null;
  const sqlState = error.sqlState ?? error.code ?? "";
  if (sqlState === "40P01") return "deadlock";
  if (sqlState === "40001") return "serialization";
  if (sqlState === "55P03") return "lock_timeout";
  return null;
}
