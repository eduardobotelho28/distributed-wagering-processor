import { afterAll, beforeAll, expect, test } from "bun:test";
import { MikroORM, type EntityManager } from "@mikro-orm/postgresql";
import { loadConfig } from "../../../src/infrastructure/config/app-config";
import { buildMikroOrmOptions } from "../../../src/infrastructure/persistence/mikro-orm.config";

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init(buildMikroOrmOptions(loadConfig(process.env).database.url));
  await orm.migrator.up();
});

afterAll(async () => {
  await orm.close();
});

class LeakGuard extends Error {}

async function insertLedgerEntry(em: EntityManager): Promise<string> {
  const conn = em.getConnection();
  const ctx = em.getTransactionContext();
  const walletId = crypto.randomUUID();
  const txId = crypto.randomUUID();
  const entryId = crypto.randomUUID();
  await conn.execute(
    `insert into wallets (id, player_id, currency, balance, created_at, updated_at)
     values (?, ?, 'BRL', '90.00', now(), now())`,
    [walletId, `player-${walletId}`],
    "run",
    ctx,
  );
  await conn.execute(
    `insert into wager_transactions (id, idempotency_key, provider_id, external_transaction_id,
       player_id, wallet_id, round_id, game_id, kind, amount, currency, payload_hash, status, created_at)
     values (?, ?, 'p', ?, 'player', ?, 'r', 'g', 'BET', '10.00', 'BRL', repeat('a', 64), 'PROCESSED', now())`,
    [txId, txId, txId, walletId],
    "run",
    ctx,
  );
  await conn.execute(
    `insert into wallet_ledger_entries (id, wallet_id, transaction_id, direction, amount,
       balance_before, balance_after, created_at)
     values (?, ?, ?, 'DEBIT', '10.00', '100.00', '90.00', now())`,
    [entryId, walletId, txId],
    "run",
    ctx,
  );
  return entryId;
}

// DECISION: tudo roda numa transação que sempre termina em rollback; se o trigger não
// disparar, LeakGuard aborta a transação e o teste falha pela mensagem errada.
async function mutateInsideRolledBackTransaction(sql: string): Promise<void> {
  await orm.em.fork().transactional(async (em) => {
    const entryId = await insertLedgerEntry(em);
    await em.getConnection().execute(sql, [entryId], "run", em.getTransactionContext());
    throw new LeakGuard();
  });
}

test("rejects UPDATE on a ledger entry", async () => {
  const run = mutateInsideRolledBackTransaction(
    `update wallet_ledger_entries set created_at = now() where id = ?`,
  );
  await expect(run).rejects.toThrow("append-only");
});

test("rejects DELETE on a ledger entry", async () => {
  const run = mutateInsideRolledBackTransaction(`delete from wallet_ledger_entries where id = ?`);
  await expect(run).rejects.toThrow("append-only");
});
