// Tabela fixa de status (TASKS.md, "Fixed decisions"); a mesma em todos os endpoints.
//
//   situação                                   status  code                    retryable
//   payload inválido / header ausente          400     INVALID_PAYLOAD (*)     false
//   sem autenticação (com IdP ligado)          401     UNAUTHENTICATED         false
//   recurso não encontrado                     404     <RECURSO>_NOT_FOUND     false
//   conflito de idempotência / duplicidade     409     IDEMPOTENCY_CONFLICT    false
//                                                      WALLET_ALREADY_EXISTS   false
//   rejeição de regra de negócio (e replay)    422     <FailureCode>           false
//   aceito com referência pendente             202     (corpo da transação)    -
//   processado (primeira vez / replay)         201/200 (corpo da transação)    -
//   falha interna permanente (FAILED)          500     INTERNAL_PERMANENT_ERROR false
//   erro inesperado                            500     INTERNAL_ERROR          false
//   falha transitória de infraestrutura        503     TRANSIENT_FAILURE       true  + Retry-After
//
// (*) ou um código mais específico (ex.: REFERENCE_REQUIRED, OPENING_NOT_ALLOWED).
// DECISION: `retryable` é a única coisa que o provedor precisa ler para decidir reenviar;
// só 503 é true. Reenviar 4xx/500 com o mesmo payload dá o mesmo resultado.
export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  INTERNAL: 500,
  UNAVAILABLE: 503,
} as const;

export type HttpStatusCode = (typeof HttpStatus)[keyof typeof HttpStatus];

// DECISION: 1s; falhas transitórias (deadlock, pool esgotado) costumam passar em segundos e
// o provedor ainda aplica o próprio backoff por cima.
export const RETRY_AFTER_SECONDS = 1;
