import { AbandonWagerMessageUseCase } from "../../src/application/abandon-wager-message/abandon-wager-message.use-case";
import { ConsumeWagerMessageUseCase } from "../../src/application/consume-wager-message/consume-wager-message.use-case";
import type { ReceivedMessage } from "../../src/application/ports/message-queue";
import { WagerMessageConsumer } from "../../src/interfaces/sqs/wager-message.consumer";
import { RecordingLogger, RecordingMessageQueue, RecordingMetrics } from "./fakes";
import { createSubmitFixture, type SubmitFixture } from "./submit-fixture";

export const QUEUE = "wager-transactions.fifo";
export const DLQ = "wager-transactions-dlq.fifo";

export interface ConsumerFixture {
  submit: SubmitFixture;
  logger: RecordingLogger;
  metrics: RecordingMetrics;
  queue: RecordingMessageQueue;
  consumer: WagerMessageConsumer;
  message(data?: Record<string, unknown>, receiveCount?: number): ReceivedMessage;
}

export async function createConsumerFixture(balance = "100.00"): Promise<ConsumerFixture> {
  const submit = await createSubmitFixture(balance);
  const queue = new RecordingMessageQueue();
  const logger = new RecordingLogger();
  const metrics = new RecordingMetrics();
  const consumer = new WagerMessageConsumer(
    {
      queue,
      consume: new ConsumeWagerMessageUseCase(submit.unitOfWork, submit.clock, submit.ids),
      abandon: new AbandonWagerMessageUseCase(submit.unitOfWork, submit.clock, submit.ids),
      clock: submit.clock,
      logger,
      metrics,
    },
    {
      queueName: QUEUE,
      deadLetterQueueName: DLQ,
      consumerName: "wager-transactions-consumer",
      maxReceives: 5,
    },
  );
  return {
    submit,
    logger,
    metrics,
    queue,
    consumer,
    message(data = {}, receiveCount = 1) {
      const externalTransactionId = crypto.randomUUID();
      const body = {
        messageId: `msg-${externalTransactionId}`,
        type: "WagerTransactionRequested",
        occurredAt: "2026-11-14T12:00:00.000Z",
        data: {
          providerId: "provider-a",
          externalTransactionId,
          idempotencyKey: `provider-a:${externalTransactionId}`,
          playerId: submit.wallet.playerId,
          walletId: submit.wallet.id,
          roundId: "round-1",
          gameId: "game-1",
          kind: "BET",
          money: { amount: "10.00", currency: "BRL" },
          ...data,
        },
      };
      return {
        transportId: crypto.randomUUID(),
        receiptHandle: `receipt-${externalTransactionId}`,
        body: JSON.stringify(body),
        receiveCount,
      };
    },
  };
}
