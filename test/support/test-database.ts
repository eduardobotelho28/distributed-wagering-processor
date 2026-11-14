import { MikroORM } from "@mikro-orm/postgresql";
import { loadConfig } from "../../src/infrastructure/config/app-config";
import { buildMikroOrmOptions } from "../../src/infrastructure/persistence/mikro-orm.config";

export interface TestDatabase {
  orm: MikroORM;
  url: string;
  dispose(): Promise<void>;
}

function urlForDatabase(baseUrl: string, name: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

// DECISION: um banco descartável por suíte em vez de truncar tabelas compartilhadas.
// Suítes rodam em paralelo sem se enxergar e o ledger append-only não precisa de DELETE.
export async function createTestDatabase(): Promise<TestDatabase> {
  const baseUrl = loadConfig(process.env).database.url;
  const name = `test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = await MikroORM.init(buildMikroOrmOptions(baseUrl));
  await admin.em.getConnection().execute(`create database ${name}`);
  const url = urlForDatabase(baseUrl, name);
  const orm = await MikroORM.init(buildMikroOrmOptions(url));
  await orm.migrator.up();
  return {
    orm,
    url,
    async dispose() {
      await orm.close();
      await admin.em.getConnection().execute(`drop database if exists ${name}`);
      await admin.close();
    },
  };
}
