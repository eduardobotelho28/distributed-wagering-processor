import type { OutboxMessage } from "../../domain/outbox/outbox-message";
import type { Clock } from "../ports/clock";
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
    } catch {
      return false;
    }
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
      return;
    }
    message.scheduleRetry(now);
    await outbox.scheduleRetry(message);
  }
}
