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

class RollbackSignal extends Error {}

async function insertTransaction(
  em: EntityManager,
  kind: string,
  status: string,
  referenceId: string | null,
): Promise<string> {
  const id = crypto.randomUUID();
  await em.getConnection().execute(
    `insert into wager_transactions (id, idempotency_key, provider_id, external_transaction_id,
       player_id, wallet_id, round_id, game_id, kind, amount, currency,
       reference_external_transaction_id, reference_transaction_id, payload_hash, status, created_at)
     values (?, ?, 'p', ?, 'player', ?, 'r', 'g', ?, '10.00', 'BRL', ?, ?, repeat('a', 64), ?, now())`,
    [id, id, id, crypto.randomUUID(), kind, referenceId, referenceId, status],
    "run",
    em.getTransactionContext(),
  );
  return id;
}

// DECISION: transação sempre termina em rollback para não sujar o banco entre testes.
async function insertReversalsInRolledBackTransaction(
  first: { kind: string; status: string },
  second: { kind: string; status: string },
): Promise<void> {
  await orm.em.fork().transactional(async (em) => {
    const betId = await insertTransaction(em, "BET", "PROCESSED", null);
    await insertTransaction(em, first.kind, first.status, betId);
    await insertTransaction(em, second.kind, second.status, betId);
    throw new RollbackSignal();
  });
}

test("rejects a second processed reversal of the same reference", async () => {
  const run = insertReversalsInRolledBackTransaction(
    { kind: "REFUND", status: "PROCESSED" },
    { kind: "ROLLBACK", status: "PROCESSED" },
  );
  await expect(run).rejects.toThrow("wager_transactions_single_reversal_per_reference_idx");
});

test("allows a rejected reversal alongside a processed one", async () => {
  const run = insertReversalsInRolledBackTransaction(
    { kind: "REFUND", status: "PROCESSED" },
    { kind: "REFUND", status: "REJECTED" },
  );
  await expect(run).rejects.toBeInstanceOf(RollbackSignal);
});
