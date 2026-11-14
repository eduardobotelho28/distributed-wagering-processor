import type { INestApplication } from "@nestjs/common";
import { GlobalExceptionFilter } from "./errors/global-exception.filter";

// DECISION: um único ponto de configuração HTTP, usado pelo main e pelos testes e2e, para que
// os testes exercitem exatamente o mesmo filtro e pipeline da produção.
export function configureHttpApp(app: INestApplication): void {
  app.useGlobalFilters(new GlobalExceptionFilter());
}
