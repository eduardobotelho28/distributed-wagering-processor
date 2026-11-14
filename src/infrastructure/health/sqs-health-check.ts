import type { HealthCheck, HealthStatus } from "../../application/ports/health-check";
import { HEALTH_CHECK_TIMEOUT_MS, withTimeout } from "./with-timeout";

// RISK: sem o AWS SDK (chega na T70), a checagem só prova que o endpoint SQS responde HTTP,
// não que a fila existe. A T70 deve trocar por GetQueueUrl/GetQueueAttributes na fila real.
export class SqsHealthCheck implements HealthCheck {
  readonly name = "sqs";

  constructor(private readonly endpoint: string) {}

  check(): Promise<HealthStatus> {
    return withTimeout(async () => {
      await fetch(this.endpoint, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
      return true;
    });
  }
}
