import type { EntityManager } from "@mikro-orm/postgresql";
import { Money } from "../../../domain/money/money";
import type { WalletLedgerEntry } from "../../../domain/wallet/wallet-ledger-entry";
import { decodeLedgerCursor, encodeLedgerCursor } from "../ledger-cursor";
import { ledgerEntryToDomain, ledgerEntryToModel } from "../mappers/wallet-ledger-entry.mapper";
import { moneyFromColumns } from "../money-columns";
import { WalletLedgerEntrySchema } from "../models/wallet-ledger-entry.model";

export interface LedgerPageQuery {
  walletId: string;
  currency: string;
  cursor: string | null;
  limit: number;
}

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  nextCursor: string | null;
}

// INVARIANT: só existe insert. O ledger é append-only; o trigger da migration T33 barra
// UPDATE/DELETE mesmo que alguém tente por fora deste repositório.
export class LedgerRepository {
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

  // DECISION: soma no banco como texto; o numeric nunca passa por number no caminho.
  async sumByWallet(walletId: string, currency: string): Promise<Money> {
    const rows = await this.em.getConnection().execute<{ total: unknown }[]>(
      `select coalesce(sum(case when direction = 'CREDIT' then amount else -amount end), 0)::numeric(19,2)::text as total
         from wallet_ledger_entries where wallet_id = ?`,
      [walletId],
      "all",
      this.em.getTransactionContext(),
    );
    const total = rows[0]?.total;
    if (total === undefined) return Money.zero(currency);
    return moneyFromColumns({ amount: total, currency });
  }
}
