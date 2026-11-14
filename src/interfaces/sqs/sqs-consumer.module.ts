import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type Provider,
} from "@nestjs/common";
import { AbandonWagerMessageUseCase } from "../../application/abandon-wager-message/abandon-wager-message.use-case";
import { ConsumeWagerMessageUseCase } from "../../application/consume-wager-message/consume-wager-message.use-case";
import type { Clock } from "../../application/ports/clock";
import type { IdGenerator } from "../../application/ports/id-generator";
import type { Logger } from "../../application/ports/logger";
import type { Metrics } from "../../application/ports/metrics";
import type { UnitOfWork } from "../../application/ports/unit-of-work";
import type { AppConfig } from "../../infrastructure/config/app-config";
import { APP_CONFIG } from "../../infrastructure/config/app-config.module";
import { createSqsClient } from "../../infrastructure/messaging/sqs-client";
import { SqsMessageQueue } from "../../infrastructure/messaging/sqs-message-queue";
import * as tokens from "../tokens";
import { ConsumerRunner } from "./consumer-runner";
import { WagerMessageConsumer } from "./wager-message.consumer";

export const CONSUMER_NAME = "wager-transactions-consumer";
// INVARIANT: igual ao maxReceiveCount do RedrivePolicy (docker/localstack/init-queues.sh).
const MAX_RECEIVES = 5;
const WAIT_TIME_SECONDS = 2;
const ERROR_BACKOFF_MS = 1_000;
const CONSUMER_RUNNER = Symbol("CONSUMER_RUNNER");

function buildRunner(
  config: AppConfig,
  unitOfWork: UnitOfWork,
  clock: Clock,
  ids: IdGenerator,
  logger: Logger,
  metrics: Metrics,
): ConsumerRunner {
  const consumer = new WagerMessageConsumer(
    {
      queue: new SqsMessageQueue(createSqsClient(config.sqs)),
      consume: new ConsumeWagerMessageUseCase(unitOfWork, clock, ids),
      abandon: new AbandonWagerMessageUseCase(unitOfWork, clock, ids),
      clock,
      logger,
      metrics,
    },
    {
      queueName: config.sqs.transactionsQueue,
      deadLetterQueueName: config.sqs.transactionsDlq,
      consumerName: CONSUMER_NAME,
      maxReceives: MAX_RECEIVES,
    },
  );
  return new ConsumerRunner(
    consumer,
    {
      maxMessages: config.limits.sqsMaxMessages,
      waitTimeSeconds: WAIT_TIME_SECONDS,
      errorBackoffMs: ERROR_BACKOFF_MS,
    },
    logger,
  );
}

// DECISION: o consumidor para em beforeApplicationShutdown, que o Nest executa ANTES de fechar
// o MikroORM (onApplicationShutdown). A mensagem em andamento termina com o banco aberto.
@Injectable()
export class ConsumerLifecycle implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(@Inject(CONSUMER_RUNNER) private readonly runner: ConsumerRunner) {}

  onApplicationBootstrap(): void {
    this.runner.start();
  }

  beforeApplicationShutdown(): Promise<void> {
    return this.runner.stop();
  }
}

const providers: Provider[] = [
  {
    provide: CONSUMER_RUNNER,
    useFactory: buildRunner,
    inject: [
      APP_CONFIG,
      tokens.UNIT_OF_WORK,
      tokens.CLOCK,
      tokens.ID_GENERATOR,
      tokens.LOGGER,
      tokens.METRICS,
    ],
  },
  ConsumerLifecycle,
];

@Module({ providers })
export class SqsConsumerModule {}
