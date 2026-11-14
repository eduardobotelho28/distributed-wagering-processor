import type { HealthStatus } from "../../application/ports/health-check";

// DECISION: 2s por dependência; o readiness probe do orquestrador costuma ter timeout
// de poucos segundos e uma checagem pendurada não pode segurar a resposta.
export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

export async function withTimeout(
  probe: () => Promise<boolean>,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
): Promise<HealthStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return (await Promise.race([probe(), timeout])) ? "up" : "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}
