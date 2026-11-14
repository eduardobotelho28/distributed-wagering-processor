import { Migration } from "@mikro-orm/migrations";

export class Migration20261114230000_single_reversal_per_reference extends Migration {
  override name = "Migration20261114230000_single_reversal_per_reference";

  override up(): void {
    // DECISION: uma referência pode ser revertida no máximo UMA vez no total, por qualquer
    // REFUND/ROLLBACK. Rejeitadas/pendentes não contam, então só PROCESSED entra no índice.
    // INVARIANT: garantido pelo banco; a checagem no use case é só otimização, não garantia.
    this.addSql(`
      create unique index "wager_transactions_single_reversal_per_reference_idx"
        on "wager_transactions" ("reference_transaction_id")
        where "status" = 'PROCESSED' and "reference_transaction_id" is not null;
    `);
  }

  override down(): void {
    this.addSql(`drop index if exists "wager_transactions_single_reversal_per_reference_idx";`);
  }
}
