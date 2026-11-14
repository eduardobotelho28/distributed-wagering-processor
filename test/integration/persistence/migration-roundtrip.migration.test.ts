import { afterAll, beforeAll, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import { loadConfig } from "../../../src/infrastructure/config/app-config";
import { buildMikroOrmOptions } from "../../../src/infrastructure/persistence/mikro-orm.config";

const APP_TABLES = [
  "inbox_messages",
  "outbox_messages",
  "wager_transactions",
  "wallet_ledger_entries",
  "wallets",
];

// DECISION: banco descartável próprio; rodar down até zero no banco compartilhado quebraria outros testes de integração.
const scratchDatabase = `roundtrip_${crypto.randomUUID().replaceAll("-", "")}`;
const baseUrl = loadConfig(process.env).database.url;
let admin: MikroORM;
let orm: MikroORM;

function urlForDatabase(name: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function listAppTables(): Promise<string[]> {
  const rows = await orm.em.getConnection().execute<{ table_name: string }[]>(
    `select table_name from information_schema.tables
       where table_schema = 'public' and table_name <> 'mikro_orm_migrations'
       order by table_name`,
  );
  return rows.map((row) => row.table_name);
}

beforeAll(async () => {
  admin = await MikroORM.init(buildMikroOrmOptions(baseUrl));
  await admin.em.getConnection().execute(`create database ${scratchDatabase}`);
  orm = await MikroORM.init(buildMikroOrmOptions(urlForDatabase(scratchDatabase)));
});

afterAll(async () => {
  await orm.close();
  await admin.em.getConnection().execute(`drop database if exists ${scratchDatabase}`);
  await admin.close();
});

test("migrations go up, down and up again on an empty database", async () => {
  expect(await listAppTables()).toEqual([]);

  await orm.migrator.up();
  expect(await listAppTables()).toEqual(APP_TABLES);

  await orm.migrator.down({ to: 0 });
  expect(await listAppTables()).toEqual([]);

  await orm.migrator.up();
  expect(await listAppTables()).toEqual(APP_TABLES);
});
