import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/infrastructure/config/app-config";
import { InboxMessageSchema } from "../../src/infrastructure/persistence/models/inbox-message.model";
import { WalletLedgerEntrySchema } from "../../src/infrastructure/persistence/models/wallet-ledger-entry.model";
import { startAppProcess, waitFor } from "../support/app-process";
import { assertLedgerInvariant } from "../support/ledger-invariant";
import { createTestQueues, publish, type SqsTestQueues, walletIn } from "../support/sqs-fixture";
import { startSqsProxy, type SqsProxy } from "../support/sqs-proxy";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

const VISIBILITY_SECONDS = 2;
let db: TestDatabase;
let queues: SqsTestQueues;
let proxy: SqsProxy;

beforeAll(async () => {
  db = await createTestDatabase();
  queues = await createTestQueues(VISIBILITY_SECONDS);
  proxy = startSqsProxy(loadConfig(process.env).sqs.endpoint);
});

afterAll(async () => {
  proxy.stop();
  await queues.dispose();
  await db.dispose();
});

function consumerEnv(endpoint: string): Record<string, string> {
  return {
    DATABASE_URL: db.url,
    SQS_ENDPOINT: endpoint,
    SQS_TRANSACTIONS_QUEUE: queues.main,
    SQS_TRANSACTIONS_DLQ: queues.deadLetter,
    SQS_CONSUMER_ENABLED: "true",
  };
}

describe("consumer killed with SIGKILL after commit and before ack", () => {
  test("the redelivered message is absorbed by the inbox without a second effect", async () => {
    const wallet = await walletIn(db, "100.00");
    const messageId = `msg-kill-${crypto.randomUUID()}`;
    await publish(queues, { wallet, messageId, amount: "10.00" });
    proxy.hang("DeleteMessage");

    const doomed = startAppProcess(consumerEnv(proxy.endpoint));
    await waitFor(async () => {
      const inbox = await db.orm.em.fork().findOne(InboxMessageSchema, { messageId });
      return inbox?.processedAt != null;
    }, 30_000);
    doomed.kill("SIGKILL");
    await doomed.exited;
    expect(doomed.signalCode).toBe("SIGKILL");
    const entriesAfterCrash = await db.orm.em.fork().count(WalletLedgerEntrySchema, {
      walletId: wallet.id,
    });

    const survivor = startAppProcess(consumerEnv(loadConfig(process.env).sqs.endpoint));
    expect(await queues.depth(queues.main)).toBe(1);
    await waitFor(async () => (await queues.depth(queues.main)) === 0, 30_000);
    survivor.kill("SIGTERM");
    await survivor.exited;

    expect(entriesAfterCrash).toBe(2);
    expect(await db.orm.em.fork().count(WalletLedgerEntrySchema, { walletId: wallet.id })).toBe(2);
    await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
  }, 60_000);
});
