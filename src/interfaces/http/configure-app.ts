import type { INestApplication } from "@nestjs/common";
import type { Logger } from "../../application/ports/logger";
import type { Metrics } from "../../application/ports/metrics";
import { LOGGER, METRICS } from "../tokens";
import { GlobalExceptionFilter } from "./errors/global-exception.filter";

// DECISION: um único ponto de configuração HTTP, usado pelo main e pelos testes e2e, para que
// os testes exercitem exatamente o mesmo filtro e pipeline da produção.
export function configureHttpApp(app: INestApplication): void {
  const metrics = app.get<Metrics>(METRICS);
  const logger = app.get<Logger>(LOGGER);
  app.useGlobalFilters(new GlobalExceptionFilter({ metrics, logger }));
}
