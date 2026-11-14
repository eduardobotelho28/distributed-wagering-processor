import type { InboxMessage } from "../../../domain/inbox/inbox-message";
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
