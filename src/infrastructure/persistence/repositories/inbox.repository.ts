import type { EntityManager } from "@mikro-orm/postgresql";
import type { InboxRepositoryPort } from "../../../application/ports/repositories";
import type { InboxMessage } from "../../../domain/inbox/inbox-message";
import { inboxMessageToModel } from "../mappers/inbox-message.mapper";
import { InboxMessageSchema } from "../models/inbox-message.model";

export class InboxMessageNotPersistedError extends Error {
  constructor(consumerName: string, messageId: string) {
    super(`inbox message ${consumerName}/${messageId} was not updated`);
    this.name = "InboxMessageNotPersistedError";
  }
}

export class InboxRepository implements InboxRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  // INVARIANT: a dedup é a PK (consumer_name, message_id). ON CONFLICT DO NOTHING devolve
  // 0 linhas para a duplicata; nenhum cache em memória participa da decisão.
  async tryInsert(message: InboxMessage): Promise<boolean> {
    const result = await this.em
      .createQueryBuilder(InboxMessageSchema)
      .insert(inboxMessageToModel(message))
      .onConflict(["consumerName", "messageId"])
      .ignore()
      .execute("run");
    return result.affectedRows === 1;
  }

  async markProcessed(message: InboxMessage): Promise<void> {
    const affected = await this.em.nativeUpdate(
      InboxMessageSchema,
      { consumerName: message.consumerName, messageId: message.messageId },
      { processedAt: message.processedAt },
    );
    if (affected !== 1) {
      throw new InboxMessageNotPersistedError(message.consumerName, message.messageId);
    }
  }
}
