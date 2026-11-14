import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MessageQueue } from "../../../src/application/ports/message-queue";
import { TransactionKind } from "../../../src/domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../src/domain/transaction/transaction-status";
import { InboxMessageSchema } from "../../../src/infrastructure/persistence/models/inbox-message.model";
import { WagerTransactionSchema } from "../../../src/infrastructure/persistence/models/wager-transaction.model";
import { WalletLedgerEntrySchema } from "../../../src/infrastructure/persistence/models/wallet-ledger-entry.model";
import { assertLedgerInvariant } from "../../support/ledger-invariant";
import {
  consumerFor,
  createTestQueues,
  drain,
  publish,
  type SqsTestQueues,
  walletIn,
} from "../../support/sqs-fixture";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

// DECISION: timeout próprio; os cenários esperam long polling e a visibilidade da fila (1s)
// voltar, e o padrão de 5s do Bun estoura sob carga. Teste que estoura não é cancelado e
// passa a disputar mensagens com o seguinte.
const SCENARIO_TIMEOUT_MS = 20_000;
let db: TestDatabase;
let queues: SqsTestQueues;

beforeAll(async () => {
  db = await createTestDatabase();
  queues = await createTestQueues(1);
});

afterAll(async () => {
  await queues.dispose();
  await db.dispose();
});

function ledgerCount(walletId: string): Promise<number> {
  return db.orm.em.fork().count(WalletLedgerEntrySchema, { walletId });
}

async function deadLetters(): Promise<Record<string, unknown>[]> {
  const messages = await queues.queue.receive(queues.deadLetter, {
    maxMessages: 10,
    waitTimeSeconds: 1,
  });
  for (const message of messages) await queues.queue.ack(queues.deadLetter, message.receiptHandle);
  return messages.map((message) => JSON.parse(message.body));
}

// Simula o processo morrendo depois do commit e antes do ack: o ack nunca chega ao SQS.
class CrashBeforeAck implements MessageQueue {
  constructor(private readonly real: MessageQueue) {}

  receive: MessageQueue["receive"] = (queue, options) => this.real.receive(queue, options);
  changeVisibility: MessageQueue["changeVisibility"] = (queue, handle, seconds) =>
    this.real.changeVisibility(queue, handle, seconds);
  send: MessageQueue["send"] = (queue, message) => this.real.send(queue, message);

  async ack(): Promise<void> {
    throw new Error("process died before ack");
  }
}

describe("SQS consumer against Postgres and LocalStack", () => {
  test(
    "a redelivered message (same messageId) applies once",
    async () => {
      const wallet = await walletIn(db, "100.00");
      const spec = {
        wallet,
        externalTransactionId: crypto.randomUUID(),
        messageId: "msg-redelivered",
      };
      await publish(queues, spec);
      await publish(queues, spec);

      await drain(consumerFor(db, queues));

      expect(await ledgerCount(wallet.id)).toBe(2);
      await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
    },
    SCENARIO_TIMEOUT_MS,
  );

  test(
    "a crash after commit and before ack is redelivered without a second effect",
    async () => {
      const wallet = await walletIn(db, "100.00");
      const messageId = `msg-crash-${crypto.randomUUID()}`;
      await publish(queues, { wallet, messageId });

      const crashing = consumerFor(db, queues, new CrashBeforeAck(queues.queue));
      await expect(crashing.pollOnce(10, 2)).rejects.toThrow("process died before ack");
      expect(await ledgerCount(wallet.id)).toBe(2);

      await Bun.sleep(1_200);
      await drain(consumerFor(db, queues));

      expect(await ledgerCount(wallet.id)).toBe(2);
      const inbox = await db.orm.em.fork().findOneOrFail(InboxMessageSchema, { messageId });
      expect(inbox.processedAt).not.toBeNull();
      expect(
        await queues.queue.receive(queues.main, { maxMessages: 10, waitTimeSeconds: 1 }),
      ).toEqual([]);
      await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
    },
    SCENARIO_TIMEOUT_MS,
  );

  test(
    "a permanent message goes to the DLQ while the others are processed",
    async () => {
      const wallet = await walletIn(db, "100.00");
      await publish(queues, { wallet });
      await publish(queues, { wallet, kind: "OPENING" });
      await publish(queues, { wallet });

      await drain(consumerFor(db, queues));

      expect(await ledgerCount(wallet.id)).toBe(3);
      const dead = await deadLetters();
      expect(dead.map((entry) => entry.code)).toEqual(["OPENING_NOT_ALLOWED"]);
      await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
    },
    SCENARIO_TIMEOUT_MS,
  );

  test(
    "FIFO group = walletId: a refund sent after its BET is never pending",
    async () => {
      const [first, second] = [await walletIn(db, "100.00"), await walletIn(db, "100.00")];
      for (const wallet of [first, second]) {
        const betId = crypto.randomUUID();
        await publish(queues, { wallet, externalTransactionId: betId, amount: "30.00" });
        await publish(queues, {
          wallet,
          kind: "REFUND",
          amount: "30.00",
          referenceExternalTransactionId: betId,
        });
      }

      await drain(consumerFor(db, queues));

      for (const wallet of [first, second]) {
        const refunds = await db.orm.em.fork().find(WagerTransactionSchema, {
          walletId: wallet.id,
          kind: TransactionKind.REFUND,
        });
        expect(refunds.map((refund) => refund.status)).toEqual([TransactionStatus.PROCESSED]);
        await assertLedgerInvariant(db.orm.em.fork(), wallet.id);
      }
    },
    SCENARIO_TIMEOUT_MS,
  );
});
