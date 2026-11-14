import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, type Options } from "@mikro-orm/postgresql";

// DECISION: MikroORM em vez de TypeORM/SQL puro. Unit of Work dá flush atômico de carteira + ledger + outbox, `em.transactional` delimita a transação de forma explícita e `LockMode.PESSIMISTIC_WRITE` gera o `SELECT ... FOR UPDATE` que o modelo de concorrência exige.
export function buildMikroOrmOptions(databaseUrl: string): Options {
  return defineConfig({
    clientUrl: databaseUrl,
    entities: [],
    // DECISION: sem entidades até T31+; o boot não deve falhar por isso.
    discovery: { warnWhenNoEntities: false },
    extensions: [Migrator],
    migrations: { path: "src/infrastructure/persistence/migrations", glob: "!(*.d).ts" },
    debug: false,
  });
}
