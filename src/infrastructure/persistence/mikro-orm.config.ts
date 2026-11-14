import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, type Options } from "@mikro-orm/postgresql";
import { WagerTransactionSchema } from "./models/wager-transaction.model";
import { WalletLedgerEntrySchema } from "./models/wallet-ledger-entry.model";
import { WalletSchema } from "./models/wallet.model";

// DECISION: MikroORM em vez de TypeORM/SQL puro. Unit of Work dá flush atômico de carteira + ledger + outbox, `em.transactional` delimita a transação de forma explícita e `LockMode.PESSIMISTIC_WRITE` gera o `SELECT ... FOR UPDATE` que o modelo de concorrência exige.
export function buildMikroOrmOptions(databaseUrl: string): Options {
  return defineConfig({
    clientUrl: databaseUrl,
    entities: [WalletSchema, WagerTransactionSchema, WalletLedgerEntrySchema],
    extensions: [Migrator],
    // DECISION: sem snapshot; migrations são escritas à mão e o snapshot vazaria um arquivo por banco de teste.
    migrations: {
      path: "src/infrastructure/persistence/migrations",
      glob: "!(*.d).ts",
      snapshot: false,
    },
    debug: false,
  });
}
