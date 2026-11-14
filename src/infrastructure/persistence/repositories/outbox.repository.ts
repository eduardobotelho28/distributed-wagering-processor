import { type EntityManager, LockMode } from "@mikro-orm/postgresql";
import type { OutboxRepositoryPort } from "../../../application/ports/repositories";
import type { OutboxMessage } from "../../../domain/outbox/outbox-message";
import { outboxMessageToDomain, outboxMessageToModel } from "../mappers/outbox-message.mapper";
import { OutboxMessageSchema } from "../models/outbox-message.model";

export class OutboxMessageNotPersistedError extends Error {
  constructor(id: string) {
    super(`outbox message ${id} was not updated`);
    this.name = "OutboxMessageNotPersistedError";
  }
}

export class OutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  // INVARIANT: chamado dentro da mesma transação que altera saldo/ledger; o evento só
  // existe se o commit acontecer.
  async insert(message: OutboxMessage): Promise<void> {
    await this.em.insert(OutboxMessageSchema, outboxMessageToModel(message));
  }

  // DECISION: FOR UPDATE SKIP LOCKED; publishers concorrentes pegam lotes disjuntos e uma
  // mensagem travada por um publisher lento não bloqueia os outros. Precisa de transação.
  async lockDueBatchSkipLocked(limit: number, now: Date): Promise<OutboxMessage[]> {
    const models = await this.em.find(
      OutboxMessageSchema,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      {
        orderBy: { nextAttemptAt: "asc", occurredAt: "asc", id: "asc" },
        limit,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        disableIdentityMap: true,
      },
    );
    return models.map(outboxMessageToDomain);
  }

  async markPublished(message: OutboxMessage): Promise<void> {
    await this.updateDelivery(message);
  }

  async scheduleRetry(message: OutboxMessage): Promise<void> {
    await this.updateDelivery(message);
  }

  private async updateDelivery(message: OutboxMessage): Promise<void> {
    const affected = await this.em.nativeUpdate(
      OutboxMessageSchema,
      { id: message.id },
      {
        attempts: message.attempts,
        nextAttemptAt: message.nextAttemptAt,
        publishedAt: message.publishedAt,
      },
    );
    if (affected !== 1) throw new OutboxMessageNotPersistedError(message.id);
  }
}
