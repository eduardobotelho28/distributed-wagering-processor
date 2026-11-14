import { Controller, Get, Res } from "@nestjs/common";
import { PrometheusMetrics } from "../../../infrastructure/observability/prometheus-metrics";
import { Public } from "../auth/public.decorator";

interface TextResponse {
  setHeader(name: string, value: string): void;
}

// DECISION: /metrics público como o health; o scrape do Prometheus roda na rede interna.
// RISK: exposto sem autenticação; em produção ficaria atrás do ingress interno.
@Public()
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: PrometheusMetrics) {}

  @Get()
  async scrape(@Res({ passthrough: true }) response: TextResponse): Promise<string> {
    response.setHeader("Content-Type", this.metrics.contentType);
    return this.metrics.render();
  }
}
