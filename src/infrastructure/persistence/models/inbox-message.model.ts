import { defineEntity, type InferEntity, p } from "@mikro-orm/postgresql";

export const InboxMessageSchema = defineEntity({
  name: "InboxMessageModel",
  tableName: "inbox_messages",
  properties: {
    consumerName: p.string().primary(),
    messageId: p.string().primary(),
    payloadHash: p.string().columnType("char(64)"),
    receivedAt: p.datetime(),
    processedAt: p.datetime().nullable(),
  },
});

export type InboxMessageModel = InferEntity<typeof InboxMessageSchema>;
