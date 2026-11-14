import { Migration } from "@mikro-orm/migrations";

export class Migration20261114194256_wallets extends Migration {
  override name = "Migration20261114194256_wallets";

  override up(): void {
    // DECISION: o id é gerado pelo domínio, então não há DEFAULT no banco.
    // INVARIANT: balance >= 0 também é garantido no domínio (Wallet.debit); o CHECK é a última barreira.
    // INVARIANT: uma carteira por (player_id, currency).
    this.addSql(`
      create table "wallets" (
        "id" uuid not null,
        "player_id" varchar(255) not null,
        "currency" char(3) not null,
        "balance" numeric(19,2) not null default 0,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "wallets_pkey" primary key ("id"),
        constraint "wallets_player_id_currency_unique" unique ("player_id", "currency"),
        constraint "wallets_balance_non_negative" check ("balance" >= 0)
      );
    `);
  }

  override down(): void {
    this.addSql(`drop table if exists "wallets";`);
  }
}
