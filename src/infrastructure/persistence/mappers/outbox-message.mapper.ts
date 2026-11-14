import { OutboxMessage } from "../../../domain/outbox/outbox-message";
import type { OutboxMessageModel } from "../models/outbox-message.model";

// DECISION: next_attempt_at nulo no banco equivale a "devido desde a ocorrência", o mesmo
// valor que OutboxMessage.enqueue atribui. O domínio nunca trabalha com o nulo.
export function outboxMessageToDomain(model: OutboxMessageModel): OutboxMessage {
  return OutboxMessage.rehydrate({
    id: model.id,
    aggregateId: model.aggregateId,
    eventType: model.eventType,
    payload: model.payload,
    occurredAt: model.occurredAt,
    attempts: model.attempts,
    nextAttemptAt: model.nextAttemptAt ?? model.occurredAt,
    publishedAt: model.publishedAt ?? null,
  });
}

export function outboxMessageToModel(message: OutboxMessage): OutboxMessageModel {
  return {
    id: message.id,
    aggregateId: message.aggregateId,
    eventType: message.eventType,
    payload: message.payload,
    occurredAt: message.occurredAt,
    attempts: message.attempts,
    nextAttemptAt: message.nextAttemptAt,
    publishedAt: message.publishedAt,
  };
}
