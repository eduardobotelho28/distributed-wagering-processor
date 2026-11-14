import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { InboxMessage } from "../../../../src/domain/inbox/inbox-message";
import { OutboxMessage } from "../../../../src/domain/outbox/outbox-message";
import { InboxMessageSchema } from "../../../../src/infrastructure/persistence/models/inbox-message.model";
import { OutboxMessageSchema } from "../../../../src/infrastructure/persistence/models/outbox-message.model";
import { InboxRepository } from "../../../../src/infrastructure/persistence/repositories/inbox.repository";
import { OutboxRepository } from "../../../../src/infrastructure/persistence/repositories/outbox.repository";
import { FIXED_NOW } from "../../../support/factories";
import { createTestDatabase, type TestDatabase } from "../../../support/test-database";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.dispose();
});

function receive(messageId: string): InboxMessage {
  return InboxMessage.receive({
    consumerName: "wager-consumer",
    messageId,
    payloadHash: "f".repeat(64),
    receivedAt: FIXED_NOW,
  });
}

function enqueue(occurredAt: Date): OutboxMessage {
  return OutboxMessage.enqueue({
    eventId: crypto.randomUUID(),
    eventType: "WagerTransactionProcessed",
    aggregateId: crypto.randomUUID(),
    occurredAt,
    toJSON: () => ({ data: { amount: "10.00", currency: "BRL" } }),
  });
}

async function insertOutbox(occurredAt: Date): Promise<OutboxMessage> {
  const message = enqueue(occurredAt);
  await new OutboxRepository(db.orm.em.fork()).insert(message);
  return message;
}

async function clearOutbox(): Promise<void> {
  await db.orm.em.fork().nativeDelete(OutboxMessageSchema, {});
}

describe("InboxRepository", () => {
  test("inserts a new message and ignores its duplicate", async () => {
    const repository = new InboxRepository(db.orm.em.fork());
    const messageId = crypto.randomUUID();

    expect(await repository.tryInsert(receive(messageId))).toBe(true);
    expect(await repository.tryInsert(receive(messageId))).toBe(false);
  });

  test("marks a message as processed", async () => {
    const message = receive(crypto.randomUUID());
    const repository = new InboxRepository(db.orm.em.fork());
    await repository.tryInsert(message);

    message.markProcessed(FIXED_NOW);
    await repository.markProcessed(message);

    const row = await db.orm.em
      .fork()
      .findOneOrFail(InboxMessageSchema, { messageId: message.messageId });
    expect(row.processedAt).toEqual(FIXED_NOW);
  });
});

describe("OutboxRepository", () => {
  test("locks only due unpublished messages, oldest first", async () => {
    await clearOutbox();
    const older = await insertOutbox(new Date(FIXED_NOW.getTime() - 2_000));
    const newer = await insertOutbox(new Date(FIXED_NOW.getTime() - 1_000));
    await insertOutbox(new Date(FIXED_NOW.getTime() + 60_000));
    const published = await insertOutbox(new Date(FIXED_NOW.getTime() - 3_000));
    published.markPublished(FIXED_NOW);
    await new OutboxRepository(db.orm.em.fork()).markPublished(published);

    const batch = await db.orm.em
      .fork()
      .transactional((em) => new OutboxRepository(em).lockDueBatchSkipLocked(10, FIXED_NOW));

    expect(batch.map((message) => message.id)).toEqual([older.id, newer.id]);
    expect(batch[0]?.payload).toEqual({ data: { amount: "10.00", currency: "BRL" } });
    expect(batch[0]?.aggregateId).toBe(older.aggregateId);
  });

  test("persists a scheduled retry so the message is not due yet", async () => {
    await clearOutbox();
    const message = await insertOutbox(new Date(FIXED_NOW.getTime() - 1_000));

    message.scheduleRetry(FIXED_NOW);
    await new OutboxRepository(db.orm.em.fork()).scheduleRetry(message);

    const lock = (now: Date): Promise<OutboxMessage[]> =>
      db.orm.em
        .fork()
        .transactional((em) => new OutboxRepository(em).lockDueBatchSkipLocked(10, now));
    expect(await lock(FIXED_NOW)).toEqual([]);
    const later = await lock(message.nextAttemptAt);
    expect(later.map((due) => due.attempts)).toEqual([1]);
  });

  test("two concurrent lockDueBatch calls return disjoint rows", async () => {
    await clearOutbox();
    for (let index = 0; index < 4; index += 1) {
      await insertOutbox(new Date(FIXED_NOW.getTime() - 1_000 - index));
    }
    let release = (): void => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalLocked = (): void => {};
    const firstLocked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });

    const first = db.orm.em.fork().transactional(async (em) => {
      const batch = await new OutboxRepository(em).lockDueBatchSkipLocked(2, FIXED_NOW);
      signalLocked();
      await hold;
      return batch.map((message) => message.id);
    });
    await firstLocked;
    const second = await db.orm.em.fork().transactional(async (em) => {
      const batch = await new OutboxRepository(em).lockDueBatchSkipLocked(2, FIXED_NOW);
      return batch.map((message) => message.id);
    });
    release();
    const firstIds = await first;

    expect(firstIds).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(firstIds.filter((id) => second.includes(id))).toEqual([]);
  });
});
