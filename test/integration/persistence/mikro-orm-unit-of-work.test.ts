import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { InboxMessage } from "../../../src/domain/inbox/inbox-message";
import { Money } from "../../../src/domain/money/money";
import { OutboxMessage } from "../../../src/domain/outbox/outbox-message";
import { Wallet } from "../../../src/domain/wallet/wallet";
import type { TransactionalRepositories } from "../../../src/application/ports/unit-of-work";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { InboxMessageSchema } from "../../../src/infrastructure/persistence/models/inbox-message.model";
import { OutboxMessageSchema } from "../../../src/infrastructure/persistence/models/outbox-message.model";
import { WagerTransactionSchema } from "../../../src/infrastructure/persistence/models/wager-transaction.model";
import { WalletLedgerEntrySchema } from "../../../src/infrastructure/persistence/models/wallet-ledger-entry.model";
import { WalletSchema } from "../../../src/infrastructure/persistence/models/wallet.model";
import { FIXED_NOW } from "../../support/factories";
import { assertLedgerInvariant } from "../../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";
import { buildWagerTransaction } from "../../support/wager-transaction-builder";

let db: TestDatabase;
let unitOfWork: MikroOrmUnitOfWork;

beforeAll(async () => {
  db = await createTestDatabase();
  unitOfWork = new MikroOrmUnitOfWork(db.orm);
});

afterAll(async () => {
  await db.dispose();
});

class AbortWork extends Error {}

interface WrittenIds {
  walletId: string;
  transactionId: string;
  messageId: string;
  outboxId: string;
}

// Simula o caso de uso completo: carteira + transação + lançamento + inbox + outbox.
async function writeEverything(repositories: TransactionalRepositories): Promise<WrittenIds> {
  const wallet = Wallet.open({
    id: crypto.randomUUID(),
    playerId: `player-${crypto.randomUUID()}`,
    initialBalance: Money.zero("BRL"),
  });
  await repositories.wallets.insert(wallet, FIXED_NOW);
  const transaction = buildWagerTransaction({ walletId: wallet.id });
  await repositories.transactions.insert(transaction);
  const entry = wallet.credit(
    Money.from({ amount: "5.00", currency: "BRL" }),
    transaction.id,
    FIXED_NOW,
  );
  await repositories.ledger.insert(entry);
  await repositories.wallets.saveBalance(wallet, FIXED_NOW);
  const inbox = InboxMessage.receive({
    consumerName: "wager-consumer",
    messageId: crypto.randomUUID(),
    payloadHash: "f".repeat(64),
    receivedAt: FIXED_NOW,
  });
  await repositories.inbox.tryInsert(inbox);
  const outbox = OutboxMessage.enqueue(
    {
      eventId: crypto.randomUUID(),
      eventType: "WalletBalanceChanged",
      occurredAt: FIXED_NOW,
      toJSON: () => ({}),
    },
    wallet.id,
  );
  await repositories.outbox.insert(outbox);
  return {
    walletId: wallet.id,
    transactionId: transaction.id,
    messageId: inbox.messageId,
    outboxId: outbox.id,
  };
}

async function countRows(ids: WrittenIds): Promise<number[]> {
  const em = db.orm.em.fork();
  return Promise.all([
    em.count(WalletSchema, { id: ids.walletId }),
    em.count(WagerTransactionSchema, { id: ids.transactionId }),
    em.count(WalletLedgerEntrySchema, { walletId: ids.walletId }),
    em.count(InboxMessageSchema, { messageId: ids.messageId }),
    em.count(OutboxMessageSchema, { id: ids.outboxId }),
  ]);
}

describe("MikroOrmUnitOfWork", () => {
  test("commits wallet, transaction, ledger, inbox and outbox together", async () => {
    const ids = await unitOfWork.run(writeEverything);

    expect(await countRows(ids)).toEqual([1, 1, 1, 1, 1]);
    await assertLedgerInvariant(db.orm.em.fork(), ids.walletId);
  });

  test("rolls back every write when the work throws", async () => {
    let ids: WrittenIds | undefined;

    const run = unitOfWork.run(async (repositories) => {
      ids = await writeEverything(repositories);
      throw new AbortWork();
    });

    await expect(run).rejects.toThrow(AbortWork);
    if (ids === undefined) throw new Error("work did not run");
    expect(await countRows(ids)).toEqual([0, 0, 0, 0, 0]);
  });
});
