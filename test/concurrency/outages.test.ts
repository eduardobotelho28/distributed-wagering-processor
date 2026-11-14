import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import { MikroORM } from "@mikro-orm/postgresql";
import { SubmitWagerTransactionUseCase } from "../../src/application/submit-wager-transaction/submit-wager-transaction.use-case";
import { Money } from "../../src/domain/money/money";
import { TransactionKind } from "../../src/domain/transaction/transaction-kind";
import { loadConfig } from "../../src/infrastructure/config/app-config";
import { createSqsClient } from "../../src/infrastructure/messaging/sqs-client";
import { SqsMessageQueue } from "../../src/infrastructure/messaging/sqs-message-queue";
import { buildMikroOrmOptions } from "../../src/infrastructure/persistence/mikro-orm.config";
import { MikroOrmUnitOfWork } from "../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { OutboxMessageSchema } from "../../src/infrastructure/persistence/models/outbox-message.model";
import { WagerTransactionSchema } from "../../src/infrastructure/persistence/models/wager-transaction.model";
import { SystemClock } from "../../src/infrastructure/time/system-clock";
import { UuidV7IdGenerator } from "../../src/infrastructure/time/uuid-v7-id-generator";
import { waitFor } from "../support/app-process";
import { startCluster } from "../support/cluster";
import { assertLedgerInvariant } from "../support/ledger-invariant";
import { createTestQueues, publish, type SqsTestQueues, walletIn } from "../support/sqs-fixture";
import { startSqsProxy } from "../support/sqs-proxy";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

const config = loadConfig(process.env);
const client = createSqsClient(config.sqs);
const queue = new SqsMessageQueue(client);
let db: TestDatabase;
let admin: MikroORM;

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await MikroORM.init(buildMikroOrmOptions(config.database.url));
});

afterAll(async () => {
  await setDatabaseUp(true);
  await admin.close();
  await db.dispose();
});

// Postgres "fora do ar" para as instâncias deste teste: recusa conexões novas ao banco
// descartável e derruba as abertas, sem afetar o Postgres das outras suítes.
async function setDatabaseUp(up: boolean): Promise<void> {
  const name = new URL(db.url).pathname.slice(1);
  const connection = admin.em.getConnection();
  await connection.execute(`alter database ${name} allow_connections ${up}`);
  if (up) return;
  await connection.execute(
    "select pg_terminate_backend(pid) from pg_stat_activity where datname = ? and pid <> pg_backend_pid()",
    [name],
  );
}

describe("Postgres outage during SQS processing", () => {
  let queues: SqsTestQueues;

  beforeAll(async () => {
    queues = await createTestQueues(30);
  });

  afterAll(async () => {
    await queues.dispose();
  });

  test("transient errors are retried and nothing is lost or duplicated", async () => {
    const wallet = await walletIn(db, "100.00");
    const cluster = await startCluster(1, {
      DATABASE_URL: db.url,
      SQS_TRANSACTIONS_QUEUE: queues.main,
      SQS_TRANSACTIONS_DLQ: queues.deadLetter,
      SQS_CONSUMER_ENABLED: "true",
    });
    const recorded = () =>
      db.orm.em
        .fork()
        .count(WagerTransactionSchema, { walletId: wallet.id, kind: TransactionKind.BET });

    for (let index = 0; index < 20; index += 1) await publish(queues, { wallet, amount: "1.00" });
    await waitFor(async () => (await recorded()) >= 1, 30_000);
    const recordedBeforeOutage = await recorded();
    await setDatabaseUp(false);
    await Bun.sleep(3_000);
    await setDatabaseUp(true);
    await waitFor(
      async () => (await recorded()) === 20 && (await queues.depth(queues.main)) === 0,
      90_000,
    );
    await cluster.stop();

    // A queda pegou o consumo no meio: havia mensagens ainda por processar.
    expect(recordedBeforeOutage).toBeLessThan(20);
    expect(await queues.depth(queues.deadLetter)).toBe(0);
    expect(await recorded()).toBe(20);
    await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
  }, 120_000);
});

describe("SQS outage during outbox publishing", () => {
  const eventsQueue = `test-outage-events-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await client.send(new CreateQueueCommand({ QueueName: eventsQueue }));
  });

  afterAll(async () => {
    await client.send(new DeleteQueueCommand({ QueueUrl: await queue.urlOf(eventsQueue) }));
  });

  test("publishing is retried while SQS is down and every event is delivered after", async () => {
    const proxy = startSqsProxy(config.sqs.endpoint);
    const cluster = await startCluster(1, {
      DATABASE_URL: db.url,
      SQS_ENDPOINT: proxy.endpoint,
      SQS_EVENTS_QUEUE: eventsQueue,
      BACKGROUND_WORKERS_ENABLED: "true",
      OUTBOX_PUBLISH_INTERVAL_MS: "100",
    });
    const pending = () => db.orm.em.fork().count(OutboxMessageSchema, { publishedAt: null });
    await waitFor(async () => (await pending()) === 0, 30_000);

    proxy.setDown(true);
    const wallet = await walletIn(db, "100.00");
    const submit = new SubmitWagerTransactionUseCase(
      new MikroOrmUnitOfWork(db.orm),
      new SystemClock(),
      new UuidV7IdGenerator(),
    );
    for (let index = 0; index < 5; index += 1) {
      const externalTransactionId = crypto.randomUUID();
      await submit.execute({
        idempotencyKey: `provider-a:${externalTransactionId}`,
        providerId: "provider-a",
        externalTransactionId,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: TransactionKind.BET,
        money: Money.from({ amount: "1.00", currency: "BRL" }),
        referenceExternalTransactionId: null,
        context: { correlationId: "corr-outage", causationId: null },
      });
    }
    const expected = (await db.orm.em.fork().find(OutboxMessageSchema, { publishedAt: null })).map(
      (row) => row.id,
    );
    await waitFor(async () => {
      const rows = await db.orm.em.fork().find(OutboxMessageSchema, { publishedAt: null });
      return rows.length === expected.length && rows.every((row) => row.attempts >= 1);
    }, 30_000);

    proxy.setDown(false);
    await waitFor(async () => (await pending()) === 0, 60_000);
    await cluster.stop();
    proxy.stop();

    const delivered = new Set<string>();
    let empty = 0;
    while (empty < 2) {
      const messages = await queue.receive(eventsQueue, { maxMessages: 10, waitTimeSeconds: 1 });
      empty = messages.length === 0 ? empty + 1 : 0;
      for (const message of messages) {
        delivered.add(String(JSON.parse(message.body).eventId));
        await queue.ack(eventsQueue, message.receiptHandle);
      }
    }
    for (const id of expected) expect(delivered.has(id)).toBe(true);
  }, 120_000);
});
