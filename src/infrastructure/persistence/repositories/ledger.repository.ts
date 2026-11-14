import type { EntityManager } from "@mikro-orm/postgresql";
import type {
  LedgerPage,
  LedgerPageQuery,
  LedgerRepositoryPort,
  LedgerSummary,
} from "../../../application/ports/repositories";
import type { WalletLedgerEntry } from "../../../domain/wallet/wallet-ledger-entry";
import { decodeLedgerCursor, encodeLedgerCursor } from "../ledger-cursor";
import { ledgerEntryToDomain, ledgerEntryToModel } from "../mappers/wallet-ledger-entry.mapper";
import { moneyFromColumns } from "../money-columns";
import { WalletLedgerEntrySchema } from "../models/wallet-ledger-entry.model";

interface SummaryRow {
  credits: unknown;
  debits: unknown;
  entry_count: number;
}

// INVARIANT: só existe insert. O ledger é append-only; o trigger da migration T33 barra
// UPDATE/DELETE mesmo que alguém tente por fora deste repositório.
export class LedgerRepository implements LedgerRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  async insert(entry: WalletLedgerEntry): Promise<void> {
    await this.em.insert(WalletLedgerEntrySchema, ledgerEntryToModel(entry));
  }

  // DECISION: keyset (created_at, id) em vez de OFFSET; páginas não duplicam nem pulam
  // lançamentos quando novos chegam durante a navegação. Busca limit + 1 para saber se há mais.
  async listByWallet(query: LedgerPageQuery): Promise<LedgerPage> {
    const after = query.cursor === null ? null : decodeLedgerCursor(query.cursor);
    const models = await this.em.find(
      WalletLedgerEntrySchema,
      after === null
        ? { walletId: query.walletId }
        : {
            walletId: query.walletId,
            $or: [
              { createdAt: { $gt: after.createdAt } },
              { createdAt: after.createdAt, id: { $gt: after.id } },
            ],
          },
      {
        orderBy: { createdAt: "asc", id: "asc" },
        limit: query.limit + 1,
        disableIdentityMap: true,
      },
    );
    const page = models.slice(0, query.limit);
    const last = page.at(-1);
    const hasMore = models.length > query.limit && last !== undefined;
    return {
      entries: page.map((model) => ledgerEntryToDomain(model, query.currency)),
      nextCursor: hasMore ? encodeLedgerCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  // DECISION: somas no banco como texto; o numeric nunca passa por number no caminho.
  async summarizeByWallet(walletId: string, currency: string): Promise<LedgerSummary> {
    const rows = await this.em.getConnection().execute<SummaryRow[]>(
      `select
         coalesce(sum(amount) filter (where direction = 'CREDIT'), 0)::numeric(19,2)::text as credits,
         coalesce(sum(amount) filter (where direction = 'DEBIT'), 0)::numeric(19,2)::text as debits,
         count(*)::int as entry_count
       from wallet_ledger_entries where wallet_id = ?`,
      [walletId],
      "all",
      this.em.getTransactionContext(),
    );
    const row = rows[0];
    if (row === undefined) throw new Error("aggregate query returned no row");
    return {
      credits: moneyFromColumns({ amount: row.credits, currency }),
      debits: moneyFromColumns({ amount: row.debits, currency }),
      entryCount: row.entry_count,
    };
  }
}
