import { Migration } from "@mikro-orm/migrations";

export class Migration20261114200000_wager_transactions extends Migration {
  override name = "Migration20261114200000_wager_transactions";

  override up(): void {
    // DECISION: sem FK para wallets. Rejeições com WALLET_NOT_FOUND também são persistidas
    // (replay idempotente precisa delas), então wallet_id pode apontar para carteira inexistente.
    // INVARIANT: idempotência garantida pelo banco (UNIQUE), nunca por cache em memória.
    // INVARIANT: REFUND/ROLLBACK exigem referência; também validado em WagerTransaction.create.
    this.addSql(`
      create table "wager_transactions" (
        "id" uuid not null,
        "idempotency_key" varchar(255) not null,
        "provider_id" varchar(255) not null,
        "external_transaction_id" varchar(255) not null,
        "player_id" varchar(255) not null,
        "wallet_id" uuid not null,
        "round_id" varchar(255) not null,
        "game_id" varchar(255) not null,
        "kind" varchar(16) not null,
        "amount" numeric(19,2) not null,
        "currency" char(3) not null,
        "reference_external_transaction_id" varchar(255) null,
        "reference_transaction_id" uuid null,
        "payload_hash" char(64) not null,
        "status" varchar(32) not null,
        "resulting_balance" numeric(19,2) null,
        "failure_code" varchar(64) null,
        "pending_attempts" int not null default 0,
        "next_attempt_at" timestamptz null,
        "processed_at" timestamptz null,
        "created_at" timestamptz not null,
        constraint "wager_transactions_pkey" primary key ("id"),
        constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key"),
        constraint "wager_transactions_provider_external_unique" unique ("provider_id", "external_transaction_id"),
        constraint "wager_transactions_reference_fk" foreign key ("reference_transaction_id") references "wager_transactions" ("id"),
        constraint "wager_transactions_kind_check" check ("kind" in ('BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK', 'OPENING')),
        constraint "wager_transactions_status_check" check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        constraint "wager_transactions_reversal_reference_check" check ("kind" not in ('REFUND', 'ROLLBACK') or "reference_external_transaction_id" is not null),
        constraint "wager_transactions_amount_non_negative" check ("amount" >= 0),
        constraint "wager_transactions_pending_attempts_non_negative" check ("pending_attempts" >= 0)
      );
    `);
    // DECISION: índice parcial só com PENDING_REFERENCE; o worker varre por next_attempt_at com SKIP LOCKED.
    this.addSql(`
      create index "wager_transactions_due_pending_reference_idx"
        on "wager_transactions" ("next_attempt_at")
        where "status" = 'PENDING_REFERENCE';
    `);
  }

  override down(): void {
    this.addSql(`drop table if exists "wager_transactions";`);
  }
}
