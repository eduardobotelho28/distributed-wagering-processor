import { InboxMessage } from "../../../domain/inbox/inbox-message";
import type { InboxMessageModel } from "../models/inbox-message.model";

export function inboxMessageToModel(message: InboxMessage): InboxMessageModel {
  return {
    consumerName: message.consumerName,
    messageId: message.messageId,
    payloadHash: message.payloadHash,
    receivedAt: message.receivedAt,
    processedAt: message.processedAt,
  };
}

export function inboxMessageToDomain(model: InboxMessageModel): InboxMessage {
  return InboxMessage.rehydrate({
    consumerName: model.consumerName,
    messageId: model.messageId,
    payloadHash: model.payloadHash,
    receivedAt: new Date(model.receivedAt),
    processedAt: model.processedAt ? new Date(model.processedAt) : null,
  });
}
