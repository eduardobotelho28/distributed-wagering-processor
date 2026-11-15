import { MikroORM } from "@mikro-orm/postgresql";
import { Global, Module, type Provider } from "@nestjs/common";
import type { Metrics } from "../application/ports/metrics";
import type { AppConfig } from "../infrastructure/config/app-config";
import { APP_CONFIG } from "../infrastructure/config/app-config.module";
import { PrometheusMetrics } from "../infrastructure/observability/prometheus-metrics";
import { JsonLogger } from "../infrastructure/observability/json-logger";
import { MikroOrmUnitOfWork } from "../infrastructure/persistence/mikro-orm-unit-of-work";
import { SystemClock } from "../infrastructure/time/system-clock";
import { UuidV7IdGenerator } from "../infrastructure/time/uuid-v7-id-generator";
import * as tokens from "./tokens";

const providers: Provider[] = [
  {
    provide: tokens.UNIT_OF_WORK,
    useFactory: (orm: MikroORM, config: AppConfig, metrics: Metrics) =>
      new MikroOrmUnitOfWork(orm, { lockTimeoutMs: config.limits.lockTimeoutMs, metrics }),
    inject: [MikroORM, APP_CONFIG, tokens.METRICS],
  },
  { provide: tokens.CLOCK, useValue: new SystemClock() },
  { provide: tokens.ID_GENERATOR, useValue: new UuidV7IdGenerator() },
  { provide: tokens.LOGGER, useValue: new JsonLogger() },
  { provide: PrometheusMetrics, useValue: new PrometheusMetrics() },
  { provide: tokens.METRICS, useExisting: PrometheusMetrics },
];

// DECISION: portas compartilhadas por HTTP e consumidor SQS num módulo global; os dois canais
// usam a MESMA unidade de trabalho, relógio e gerador de ids.
@Global()
@Module({
  providers,
  exports: [
    tokens.UNIT_OF_WORK,
    tokens.CLOCK,
    tokens.ID_GENERATOR,
    tokens.LOGGER,
    tokens.METRICS,
    PrometheusMetrics,
  ],
})
export class CoreModule {}
