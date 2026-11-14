import { Migration } from "@mikro-orm/migrations";

export class Migration20261114210000_wallet_ledger_entries extends Migration {
  override name = "Migration20261114210000_wallet_ledger_entries";

  override up(): void {
    // INVARIANT: balance_after = balance_before ± amount; também validado em WalletLedgerEntry.create.
    // INVARIANT: um lançamento por (wallet, transação); replay não duplica movimento.
    this.addSql(`
      create table "wallet_ledger_entries" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "transaction_id" uuid not null,
        "direction" varchar(8) not null,
        "amount" numeric(19,2) not null,
        "balance_before" numeric(19,2) not null,
        "balance_after" numeric(19,2) not null,
        "created_at" timestamptz not null,
        constraint "wallet_ledger_entries_pkey" primary key ("id"),
        constraint "wallet_ledger_entries_wallet_transaction_unique" unique ("wallet_id", "transaction_id"),
        constraint "wallet_ledger_entries_wallet_fk" foreign key ("wallet_id") references "wallets" ("id"),
        constraint "wallet_ledger_entries_transaction_fk" foreign key ("transaction_id") references "wager_transactions" ("id"),
        constraint "wallet_ledger_entries_direction_check" check ("direction" in ('DEBIT', 'CREDIT')),
        constraint "wallet_ledger_entries_amount_positive" check ("amount" > 0),
        constraint "wallet_ledger_entries_balance_after_non_negative" check ("balance_after" >= 0),
        constraint "wallet_ledger_entries_balanced_check" check (
          ("direction" = 'DEBIT' and "balance_after" = "balance_before" - "amount")
          or ("direction" = 'CREDIT' and "balance_after" = "balance_before" + "amount")
        )
      );
    `);
    // DECISION: ordenação (created_at, id) estável para paginação por cursor do extrato.
    this.addSql(`
      create index "wallet_ledger_entries_wallet_cursor_idx"
        on "wallet_ledger_entries" ("wallet_id", "created_at", "id");
    `);
    // INVARIANT: ledger é append-only; o trigger barra UPDATE/DELETE mesmo fora da aplicação.
    this.addSql(`
      create function "wallet_ledger_entries_reject_mutation"() returns trigger
      language plpgsql as $$
      begin
        raise exception 'wallet_ledger_entries is append-only: % not allowed', tg_op;
      end;
      $$;
    `);
    this.addSql(`
      create trigger "wallet_ledger_entries_append_only"
        before update or delete on "wallet_ledger_entries"
        for each row execute function "wallet_ledger_entries_reject_mutation"();
    `);
  }

  override down(): void {
    this.addSql(`drop table if exists "wallet_ledger_entries";`);
    this.addSql(`drop function if exists "wallet_ledger_entries_reject_mutation"();`);
  }
}
