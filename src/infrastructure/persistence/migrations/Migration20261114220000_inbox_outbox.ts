import { Migration } from "@mikro-orm/migrations";

export class Migration20261114220000_inbox_outbox extends Migration {
  override name = "Migration20261114220000_inbox_outbox";

  override up(): void {
    // INVARIANT: PK (consumer_name, message_id) é a garantia de dedup do consumidor SQS;
    // nenhum cache em memória substitui esta constraint.
    this.addSql(`
      create table "inbox_messages" (
        "consumer_name" varchar(100) not null,
        "message_id" varchar(255) not null,
        "payload_hash" char(64) not null,
        "received_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "inbox_messages_pkey" primary key ("consumer_name", "message_id")
      );
    `);
    this.addSql(`
      create table "outbox_messages" (
        "id" uuid not null,
        "aggregate_id" uuid not null,
        "event_type" varchar(100) not null,
        "payload" jsonb not null,
        "occurred_at" timestamptz not null,
        "attempts" int not null default 0,
        "next_attempt_at" timestamptz null,
        "published_at" timestamptz null,
        constraint "outbox_messages_pkey" primary key ("id"),
        constraint "outbox_messages_attempts_non_negative" check ("attempts" >= 0)
      );
    `);
    // DECISION: índice parcial só com pendentes; o publisher (SKIP LOCKED) varre um conjunto
    // pequeno mesmo com a tabela crescendo com mensagens já publicadas.
    this.addSql(`
      create index "outbox_messages_unpublished_idx"
        on "outbox_messages" ("next_attempt_at", "occurred_at")
        where "published_at" is null;
    `);
  }

  override down(): void {
    this.addSql(`drop table if exists "outbox_messages";`);
    this.addSql(`drop table if exists "inbox_messages";`);
  }
}
