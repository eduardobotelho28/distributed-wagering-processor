import { CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import type { MessageQueue } from "../../src/application/ports/message-queue";
import { AbandonWagerMessageUseCase } from "../../src/application/abandon-wager-message/abandon-wager-message.use-case";
import { ConsumeWagerMessageUseCase } from "../../src/application/consume-wager-message/consume-wager-message.use-case";
import { CreateWalletUseCase } from "../../src/application/create-wallet/create-wallet.use-case";
import { Money } from "../../src/domain/money/money";
import type { Wallet } from "../../src/domain/wallet/wallet";
import { loadConfig } from "../../src/infrastructure/config/app-config";
import { createSqsClient } from "../../src/infrastructure/messaging/sqs-client";
import { SqsMessageQueue } from "../../src/infrastructure/messaging/sqs-message-queue";
import { MikroOrmUnitOfWork } from "../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { SystemClock } from "../../src/infrastructure/time/system-clock";
import { UuidV7IdGenerator } from "../../src/infrastructure/time/uuid-v7-id-generator";
import { CONSUMER_NAME } from "../../src/interfaces/sqs/sqs-consumer.module";
import { WagerMessageConsumer } from "../../src/interfaces/sqs/wager-message.consumer";
import { RecordingLogger, RecordingMetrics } from "./fakes";
import type { TestDatabase } from "./test-database";

export interface SqsTestQueues {
  queue: SqsMessageQueue;
  main: string;
  deadLetter: string;
  dispose(): Promise<void>;
}

// DECISION: filas FIFO próprias por suíte, com visibilidade curta para a reentrega aparecer
// rápido; não disputam mensagens com a fila real nem com outras suítes.
export async function createTestQueues(visibilitySeconds: number): Promise<SqsTestQueues> {
  const client = createSqsClient(loadConfig(process.env).sqs);
  const queue = new SqsMessageQueue(client);
  const suffix = crypto.randomUUID();
  const main = `test-consumer-${suffix}.fifo`;
  const deadLetter = `test-consumer-dlq-${suffix}.fifo`;
  for (const name of [main, deadLetter]) {
    await client.send(
      new CreateQueueCommand({
        QueueName: name,
        Attributes: { FifoQueue: "true", VisibilityTimeout: String(visibilitySeconds) },
      }),
    );
  }
  return {
    queue,
    main,
    deadLetter,
    async dispose() {
      for (const name of [main, deadLetter]) {
        await client.send(new DeleteQueueCommand({ QueueUrl: await queue.urlOf(name) }));
      }
    },
  };
}

export function consumerFor(
  db: TestDatabase,
  queues: SqsTestQueues,
  queue: MessageQueue = queues.queue,
): WagerMessageConsumer {
  const clock = new SystemClock();
  const ids = new UuidV7IdGenerator();
  const unitOfWork = new MikroOrmUnitOfWork(db.orm);
  return new WagerMessageConsumer(
    {
      queue,
      consume: new ConsumeWagerMessageUseCase(unitOfWork, clock, ids),
      abandon: new AbandonWagerMessageUseCase(unitOfWork, clock, ids),
      clock,
      logger: new RecordingLogger(),
      metrics: new RecordingMetrics(),
    },
    {
      queueName: queues.main,
      deadLetterQueueName: queues.deadLetter,
      consumerName: CONSUMER_NAME,
      maxReceives: 5,
    },
  );
}

export async function walletIn(db: TestDatabase, balance: string): Promise<Wallet> {
  const created = await new CreateWalletUseCase(
    new MikroOrmUnitOfWork(db.orm),
    new SystemClock(),
    new UuidV7IdGenerator(),
  ).execute({
    playerId: `player-${crypto.randomUUID()}`,
    initialBalance: Money.from({ amount: balance, currency: "BRL" }),
  });
  if (created.outcome !== "created") throw new Error("expected wallet");
  return created.wallet;
}

export interface WagerMessageSpec {
  wallet: Wallet;
  externalTransactionId?: string;
  messageId?: string;
  kind?: string;
  amount?: string;
  referenceExternalTransactionId?: string;
}

export function wagerMessageBody(spec: WagerMessageSpec): string {
  const externalTransactionId = spec.externalTransactionId ?? crypto.randomUUID();
  return JSON.stringify({
    messageId: spec.messageId ?? `msg-${externalTransactionId}`,
    type: "WagerTransactionRequested",
    occurredAt: "2026-11-14T12:00:00.000Z",
    data: {
      providerId: "provider-a",
      externalTransactionId,
      idempotencyKey: `provider-a:${externalTransactionId}`,
      playerId: spec.wallet.playerId,
      walletId: spec.wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: spec.kind ?? "BET",
      money: { amount: spec.amount ?? "10.00", currency: "BRL" },
      referenceExternalTransactionId: spec.referenceExternalTransactionId,
    },
  });
}

// INVARIANT: grupo FIFO = walletId; mensagens da mesma carteira chegam em ordem.
export async function publish(queues: SqsTestQueues, spec: WagerMessageSpec): Promise<void> {
  await queues.queue.send(queues.main, {
    body: wagerMessageBody(spec),
    groupId: spec.wallet.id,
    deduplicationId: crypto.randomUUID(),
  });
}

export async function drain(consumer: WagerMessageConsumer): Promise<void> {
  let emptyPolls = 0;
  while (emptyPolls < 2) {
    emptyPolls = (await consumer.pollOnce(10, 1)) === 0 ? emptyPolls + 1 : 0;
  }
}
