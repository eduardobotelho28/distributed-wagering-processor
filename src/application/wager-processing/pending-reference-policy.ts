// DECISION: limites do PENDING_REFERENCE.
// - base 5s: referência fora de ordem costuma chegar em segundos (o provedor envia BET e
//   REFUND quase juntos, por filas diferentes);
// - backoff dobrando até o teto de 5min: alivia o banco quando a referência demora, sem
//   deixar uma referência recuperada esperando demais;
// - no máximo 8 tentativas (~15min somando 5s, 10s, 20s ... 300s, 300s) ou TTL de 1h, o que
//   vier primeiro. O TTL limita o caso de backlog, em que o worker atrasa e as tentativas
//   ficam espaçadas além do previsto.
// Esgotado o limite, a transação vira REJECTED com REFERENCE_NOT_FOUND (terminal).
export const PENDING_REFERENCE_BASE_DELAY_MS = 5_000;
export const PENDING_REFERENCE_MAX_DELAY_MS = 300_000;
export const PENDING_REFERENCE_MAX_ATTEMPTS = 8;
export const PENDING_REFERENCE_TTL_MS = 3_600_000;

// `attempts` é quantas retentativas já falharam; 0 agenda a primeira (feita na submissão).
export function nextPendingAttemptAt(attempts: number, now: Date): Date {
  const delay = Math.min(
    PENDING_REFERENCE_BASE_DELAY_MS * 2 ** attempts,
    PENDING_REFERENCE_MAX_DELAY_MS,
  );
  return new Date(now.getTime() + delay);
}

export function isPendingReferenceExhausted(attempts: number, createdAt: Date, now: Date): boolean {
  if (attempts >= PENDING_REFERENCE_MAX_ATTEMPTS) return true;
  return now.getTime() - createdAt.getTime() >= PENDING_REFERENCE_TTL_MS;
}
