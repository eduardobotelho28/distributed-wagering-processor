import { MikroORM } from "@mikro-orm/postgresql";
import { Global, Module, type Provider } from "@nestjs/common";
import { InMemoryMetrics } from "../infrastructure/observability/in-memory-metrics";
import { JsonConsoleLogger } from "../infrastructure/observability/json-console-logger";
import { MikroOrmUnitOfWork } from "../infrastructure/persistence/mikro-orm-unit-of-work";
import { SystemClock } from "../infrastructure/time/system-clock";
import { UuidV7IdGenerator } from "../infrastructure/time/uuid-v7-id-generator";
import * as tokens from "./tokens";

const providers: Provider[] = [
  {
    provide: tokens.UNIT_OF_WORK,
    useFactory: (orm: MikroORM) => new MikroOrmUnitOfWork(orm),
    inject: [MikroORM],
  },
  { provide: tokens.CLOCK, useValue: new SystemClock() },
  { provide: tokens.ID_GENERATOR, useValue: new UuidV7IdGenerator() },
  { provide: tokens.LOGGER, useValue: new JsonConsoleLogger() },
  { provide: tokens.METRICS, useValue: new InMemoryMetrics() },
];

// DECISION: portas compartilhadas por HTTP e consumidor SQS num módulo global; os dois canais
// usam a MESMA unidade de trabalho, relógio e gerador de ids.
@Global()
@Module({
  providers,
  exports: [tokens.UNIT_OF_WORK, tokens.CLOCK, tokens.ID_GENERATOR, tokens.LOGGER, tokens.METRICS],
})
export class CoreModule {}
