export type HealthStatus = "up" | "down";

// DECISION: cada dependência expõe uma checagem com nome estável; o endpoint de readiness
// agrega e não conhece detalhes de Postgres ou SQS.
// INVARIANT: check() nunca lança e responde dentro do próprio timeout; dependência lenta
// conta como "down" para o balanceador tirar a instância do ar.
export interface HealthCheck {
  readonly name: string;
  check(): Promise<HealthStatus>;
}
