import { Controller, Get, HttpCode, Inject, Res } from "@nestjs/common";
import type { HealthCheck, HealthStatus } from "../../../application/ports/health-check";
import { HttpStatus } from "../errors/http-status-table";
import { HEALTH_CHECKS } from "../tokens";

interface StatusResponse {
  status(code: number): unknown;
}

export interface ReadinessBody {
  status: "ready" | "not_ready";
  checks: Record<string, HealthStatus>;
}

@Controller("health")
export class HealthController {
  constructor(@Inject(HEALTH_CHECKS) private readonly checks: readonly HealthCheck[]) {}

  // DECISION: liveness só prova que o processo responde; não toca dependências, para o
  // orquestrador não reiniciar a instância quando o problema é o banco.
  @Get("live")
  @HttpCode(HttpStatus.OK)
  live(): { status: "alive" } {
    return { status: "alive" };
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) response: StatusResponse): Promise<ReadinessBody> {
    const results = await Promise.all(
      this.checks.map(async (check): Promise<[string, HealthStatus]> => [
        check.name,
        await check.check(),
      ]),
    );
    const checks = Object.fromEntries(results);
    const ready = results.every(([, status]) => status === "up");
    response.status(ready ? HttpStatus.OK : HttpStatus.UNAVAILABLE);
    return { status: ready ? "ready" : "not_ready", checks };
  }
}
