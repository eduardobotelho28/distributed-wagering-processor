// DECISION: tokens explícitos com @Inject em vez de depender de emitDecoratorMetadata; o
// Bun não emite metadata de tipos de forma confiável para interfaces (que somem no runtime).
export const UNIT_OF_WORK = Symbol("UNIT_OF_WORK");
export const CLOCK = Symbol("CLOCK");
export const ID_GENERATOR = Symbol("ID_GENERATOR");
export const LOGGER = Symbol("LOGGER");
export const METRICS = Symbol("METRICS");
export const HEALTH_CHECKS = Symbol("HEALTH_CHECKS");
export const CREATE_WALLET = Symbol("CREATE_WALLET");
export const GET_WALLET = Symbol("GET_WALLET");
export const GET_LEDGER = Symbol("GET_LEDGER");
export const RECONCILE_WALLET = Symbol("RECONCILE_WALLET");
export const SUBMIT_TRANSACTION = Symbol("SUBMIT_TRANSACTION");
export const GET_TRANSACTION_BY_ID = Symbol("GET_TRANSACTION_BY_ID");
export const GET_TRANSACTION_BY_EXTERNAL_ID = Symbol("GET_TRANSACTION_BY_EXTERNAL_ID");
