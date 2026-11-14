import { AsyncLocalStorage } from "node:async_hooks";

export interface LogContextFields {
  correlationId?: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
}

const storage = new AsyncLocalStorage<LogContextFields>();

// DECISION: AsyncLocalStorage em vez de passar o contexto por parâmetro; todo log disparado
// dentro de uma requisição HTTP ou do processamento de uma mensagem herda os ids de rastreio,
// inclusive os emitidos por código que não conhece a requisição (repositórios, workers).
export function runWithLogContext<T>(fields: LogContextFields, run: () => T): T {
  return storage.run({ ...fields }, run);
}

// Acrescenta ids descobertos no meio do fluxo (ex.: transactionId após o processamento).
export function addToLogContext(fields: LogContextFields): void {
  const current = storage.getStore();
  if (current !== undefined) Object.assign(current, fields);
}

export function currentLogContext(): LogContextFields {
  return { ...storage.getStore() };
}
