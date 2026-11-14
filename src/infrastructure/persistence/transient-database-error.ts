import {
  ConnectionException,
  DeadlockException,
  DriverException,
  LockWaitTimeoutException,
} from "@mikro-orm/postgresql";

// SQLSTATE: 08xxx conexão, 40001 serialização, 40P01 deadlock, 53xxx recursos (conexões
// esgotadas), 57P0x servidor reiniciando/desligando.
const TRANSIENT_SQLSTATE_PREFIXES = ["08", "40001", "40P01", "53", "57P0"];

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
