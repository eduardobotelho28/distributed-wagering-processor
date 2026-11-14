import { defineEntity, type InferEntity, p } from "@mikro-orm/postgresql";

export const OutboxMessageSchema = defineEntity({
  name: "OutboxMessageModel",
  tableName: "outbox_messages",
  properties: {
    id: p.uuid().primary(),
    aggregateId: p.uuid(),
    eventType: p.string(),
    payload: p.json<Record<string, unknown>>().columnType("jsonb"),
    occurredAt: p.datetime(),
    attempts: p.integer(),
    nextAttemptAt: p.datetime().nullable(),
    publishedAt: p.datetime().nullable(),
  },
});

export type OutboxMessageModel = InferEntity<typeof OutboxMessageSchema>;
