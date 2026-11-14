import { describe, expect, test } from "bun:test";
import { LockWaitTimeoutException } from "@mikro-orm/postgresql";
import { AbandonWagerMessageUseCase } from "../../../src/application/abandon-wager-message/abandon-wager-message.use-case";
import { ConsumeWagerMessageUseCase } from "../../../src/application/consume-wager-message/consume-wager-message.use-case";
import { PublishOutboxBatchUseCase } from "../../../src/application/publish-outbox/publish-outbox-batch.use-case";
import { OutboxMessage } from "../../../src/domain/outbox/outbox-message";
import { JsonLogger } from "../../../src/infrastructure/observability/json-logger";
import { WagerMessageConsumer } from "../../../src/interfaces/sqs/wager-message.consumer";
import { createConsumerFixture, DLQ, QUEUE } from "../../support/consumer-fixture";
import { FIXED_NOW } from "../../support/factories";
import {
  FixedClock,
  InMemoryUnitOfWork,
  RecordingLogger,
  RecordingMessageQueue,
  RecordingMetrics,
} from "../../support/fakes";

describe("consumer telemetry", () => {
  test("counts a processed message by status and channel and times it", async () => {
    const fixture = await createConsumerFixture("100.00");

    await fixture.consumer.handle(fixture.message());

    expect(fixture.metrics.increments).toEqual([
      { name: "wager_transactions_total", labels: { status: "processed", channel: "sqs" } },
    ]);
    expect(fixture.metrics.observations.map((entry) => entry.name)).toEqual([
      "wager_processing_duration_seconds",
    ]);
  });

  test("counts a redelivery as an inbox duplicate", async () => {
    const fixture = await createConsumerFixture("100.00");
    const message = fixture.message();
    await fixture.consumer.handle(message);

    await fixture.consumer.handle({ ...message, receiveCount: 2 });

    expect(fixture.metrics.increments.at(-1)).toEqual({
      name: "duplicates_detected_total",
      labels: { source: "inbox" },
    });
  });

  test("counts a lock timeout as a lock conflict and a retry", async () => {
    const fixture = await createConsumerFixture("100.00");
    fixture.submit.unitOfWork.repositories.wallets.findByIdForUpdate = async () => {
      throw new LockWaitTimeoutException(new Error("lock timeout"));
    };

    await fixture.consumer.handle(fixture.message());

    expect(fixture.metrics.increments).toEqual([
      { name: "lock_conflicts_total", labels: { kind: "lock_timeout" } },
      { name: "retries_total", labels: { kind: "sqs_message" } },
    ]);
  });

  test("counts a dead-lettered message by code", async () => {
    const fixture = await createConsumerFixture();

    await fixture.consumer.handle({ ...fixture.message(), body: "{oops" });

    expect(fixture.metrics.increments).toEqual([
      { name: "dlq_messages_total", labels: { code: "INVALID_JSON" } },
    ]);
  });

  test("every log of a message carries its ids and never the payload", async () => {
    const fixture = await createConsumerFixture("100.00");
    const lines: Record<string, unknown>[] = [];
    const consumer = new WagerMessageConsumer(
      {
        queue: new RecordingMessageQueue(),
        consume: new ConsumeWagerMessageUseCase(
          fixture.submit.unitOfWork,
          fixture.submit.clock,
          fixture.submit.ids,
        ),
        abandon: new AbandonWagerMessageUseCase(
          fixture.submit.unitOfWork,
          fixture.submit.clock,
          fixture.submit.ids,
        ),
        clock: fixture.submit.clock,
        logger: new JsonLogger((line) => lines.push(JSON.parse(line))),
        metrics: new RecordingMetrics(),
      },
      { queueName: QUEUE, deadLetterQueueName: DLQ, consumerName: "consumer", maxReceives: 5 },
    );
    const message = fixture.message();

    await consumer.handle(message);

    const body = JSON.parse(message.body);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      message: "wager transaction handled",
      messageId: body.messageId,
      correlationId: body.messageId,
      providerId: "provider-a",
      walletId: fixture.submit.wallet.id,
      transactionId: expect.any(String),
      outcome: "processed",
    });
    expect(JSON.stringify(lines)).not.toContain("10.00");
  });
});

describe("publisher telemetry", () => {
  test("observes outbox lag, counts retries and logs the event correlation id", async () => {
    const unitOfWork = new InMemoryUnitOfWork();
    const queue = new RecordingMessageQueue();
    const clock = new FixedClock(new Date(FIXED_NOW.getTime() + 2_500));
    const logger = new RecordingLogger();
    const metrics = new RecordingMetrics();
    for (const eventId of ["evt-ok", "evt-fail"]) {
      unitOfWork.repositories.outbox.messages.push(
        OutboxMessage.enqueue({
          eventId,
          eventType: "WagerTransactionProcessed",
          aggregateId: "tx-1",
          occurredAt: FIXED_NOW,
          toJSON: () => ({ eventId, correlationId: "corr-http-1" }),
        }),
      );
    }
    const send = queue.send.bind(queue);
    queue.send = async (name, message) => {
      if (message.body.includes("evt-fail")) throw new Error("throttled");
      return send(name, message);
    };

    await new PublishOutboxBatchUseCase(
      unitOfWork,
      queue,
      clock,
      { eventsQueue: "wager-events", batchSize: 10 },
      { logger, metrics },
    ).execute();

    expect(metrics.observations).toEqual([
      { name: "outbox_publish_lag_seconds", seconds: 2.5, labels: {} },
    ]);
    expect(metrics.increments).toEqual([
      { name: "retries_total", labels: { kind: "outbox_publish" } },
    ]);
    expect(logger.infos).toEqual([
      {
        message: "outbox event published",
        fields: {
          eventId: "evt-ok",
          eventType: "WagerTransactionProcessed",
          aggregateId: "tx-1",
          correlationId: "corr-http-1",
        },
      },
    ]);
  });
});
