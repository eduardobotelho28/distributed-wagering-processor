import type { OutboxMessage } from "../../domain/outbox/outbox-message";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import type { Metrics } from "../ports/metrics";
import type { MessageQueue } from "../ports/message-queue";
import type { OutboxRepositoryPort } from "../ports/repositories";
import type { UnitOfWork } from "../ports/unit-of-work";

export interface PublishOutboxOptions {
  eventsQueue: string;
  batchSize: number;
}

export interface PublishOutboxResult {
  published: number;
  failed: number;
}

// DECISION: publicação at-least-once. O lote é travado (FOR UPDATE SKIP LOCKED), enviado ao SQS
// e marcado como publicado na MESMA transação. Se o processo morrer depois do envio e antes do
// commit, a marcação some e outra instância republica: o evento pode chegar duas vezes, nunca
// zero. Exactly-once exigiria transação distribuída entre Postgres e SQS; em vez disso o
// consumidor deduplica pelo eventId (envelope do evento).
// DECISION: SKIP LOCKED é a coordenação entre N publishers; cada um pega linhas disjuntas e um
// publisher lento não bloqueia os outros. Não há eleição de líder.
export class PublishOutboxBatchUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly queue: MessageQueue,
    private readonly clock: Clock,
    private readonly options: PublishOutboxOptions,
    private readonly telemetry: { logger: Logger; metrics: Metrics },
  ) {}

  execute(): Promise<PublishOutboxResult> {
    return this.unitOfWork.run(async (repositories) => {
      const now = this.clock.now();
      const batch = await repositories.outbox.lockDueBatchSkipLocked(this.options.batchSize, now);
      const result: PublishOutboxResult = { published: 0, failed: 0 };
      for (const message of batch) {
        const sent = await this.publish(message);
        await this.record(repositories.outbox, message, sent, now);
        result[sent ? "published" : "failed"] += 1;
      }
      return result;
    });
  }

  // INVARIANT: uma falha de envio afeta só aquele evento; ele recebe backoff (1s, 2s, 4s...
  // teto 5min, OutboxMessage.scheduleRetry) e o resto do lote segue. Nada fica preso.
  private async publish(message: OutboxMessage): Promise<boolean> {
    try {
      await this.queue.send(this.options.eventsQueue, { body: JSON.stringify(message.payload) });
      return true;
    } catch (error) {
      this.telemetry.metrics.increment("retries_total", { kind: "outbox_publish" });
      this.telemetry.logger.warn("outbox event publish failed, will retry", {
        eventId: message.id,
        error: error instanceof Error ? error.name : "unknown",
      });
      return false;
    }
  }

  // DECISION: o correlationId vem do envelope gravado; é ele que liga o log da requisição HTTP
  // (ou da mensagem SQS) ao log da publicação, em outro processo e outro momento.
  private recordPublished(message: OutboxMessage, now: Date): void {
    const lagSeconds = Math.max(now.getTime() - message.occurredAt.getTime(), 0) / 1000;
    this.telemetry.metrics.observe("outbox_publish_lag_seconds", lagSeconds, {});
    const correlationId = message.payload.correlationId;
    this.telemetry.logger.info("outbox event published", {
      eventId: message.id,
      eventType: message.eventType,
      aggregateId: message.aggregateId,
      ...(typeof correlationId === "string" ? { correlationId } : {}),
    });
  }

  private async record(
    outbox: OutboxRepositoryPort,
    message: OutboxMessage,
    sent: boolean,
    now: Date,
  ): Promise<void> {
    if (sent) {
      message.markPublished(now);
      await outbox.markPublished(message);
      this.recordPublished(message, now);
      return;
    }
    message.scheduleRetry(now);
    await outbox.scheduleRetry(message);
  }
}
