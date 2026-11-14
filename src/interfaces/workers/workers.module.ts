import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type Provider,
} from "@nestjs/common";
import type { Clock } from "../../application/ports/clock";
import type { IdGenerator } from "../../application/ports/id-generator";
import type { Logger } from "../../application/ports/logger";
import type { UnitOfWork } from "../../application/ports/unit-of-work";
import { PublishOutboxBatchUseCase } from "../../application/publish-outbox/publish-outbox-batch.use-case";
import { ReprocessPendingReferenceUseCase } from "../../application/reprocess-pending-reference/reprocess-pending-reference.use-case";
import type { AppConfig } from "../../infrastructure/config/app-config";
import { APP_CONFIG } from "../../infrastructure/config/app-config.module";
import { createSqsClient } from "../../infrastructure/messaging/sqs-client";
import { SqsMessageQueue } from "../../infrastructure/messaging/sqs-message-queue";
import * as tokens from "../tokens";
import { IntervalWorker } from "./interval-worker";
import { drainPendingReferences } from "./pending-reference.tick";

const BACKGROUND_WORKERS = Symbol("BACKGROUND_WORKERS");

function buildWorkers(
  config: AppConfig,
  unitOfWork: UnitOfWork,
  clock: Clock,
  ids: IdGenerator,
  logger: Logger,
): IntervalWorker[] {
  const reprocess = new ReprocessPendingReferenceUseCase(unitOfWork, clock, ids);
  const publisher = new PublishOutboxBatchUseCase(
    unitOfWork,
    new SqsMessageQueue(createSqsClient(config.sqs)),
    clock,
    { eventsQueue: config.sqs.eventsQueue, batchSize: config.limits.outboxBatchSize },
  );
  return [
    new IntervalWorker(
      () => publisher.execute(),
      { name: "outbox-publisher", intervalMs: config.workers.outboxPublishIntervalMs },
      logger,
    ),
    new IntervalWorker(
      () => drainPendingReferences(reprocess, config.limits.pendingReferenceBatchSize),
      { name: "pending-reference", intervalMs: config.workers.pendingReferenceIntervalMs },
      logger,
    ),
  ];
}

// DECISION: cada instância roda os workers sem eleição de líder; N instâncias são seguras
// porque publisher e reprocessamento travam linhas com FOR UPDATE SKIP LOCKED e cada linha
// vai para uma só.
@Injectable()
export class WorkersLifecycle implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(@Inject(BACKGROUND_WORKERS) private readonly workers: IntervalWorker[]) {}

  onApplicationBootstrap(): void {
    for (const worker of this.workers) worker.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.stop()));
  }
}

const providers: Provider[] = [
  {
    provide: BACKGROUND_WORKERS,
    useFactory: buildWorkers,
    inject: [APP_CONFIG, tokens.UNIT_OF_WORK, tokens.CLOCK, tokens.ID_GENERATOR, tokens.LOGGER],
  },
  WorkersLifecycle,
];

@Module({ providers })
export class WorkersModule {}
