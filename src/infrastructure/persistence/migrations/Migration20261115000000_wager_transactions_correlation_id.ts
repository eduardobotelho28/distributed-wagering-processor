import { Migration } from "@mikro-orm/migrations";

export class Migration20261115000000_wager_transactions_correlation_id extends Migration {
  override name = "Migration20261115000000_wager_transactions_correlation_id";

  override up(): void {
    // DECISION: correlation_id da requisição/mensagem que criou a transação. O worker de
    // PENDING_REFERENCE roda minutos depois em outro processo; sem a coluna, os eventos dele
    // perdiam a ligação com a requisição original. Nullable: linhas antigas não têm o valor.
    this.addSql(`alter table "wager_transactions" add column "correlation_id" varchar(255) null;`);
  }

  override down(): void {
    this.addSql(`alter table "wager_transactions" drop column if exists "correlation_id";`);
  }
}
