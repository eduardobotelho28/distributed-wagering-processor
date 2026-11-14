import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import { InvalidLedgerCursorError } from "../ports/invalid-ledger-cursor.error";
import type { UnitOfWork } from "../ports/unit-of-work";

export interface GetLedgerInput {
  walletId: string;
  cursor: string | null;
  limit: number;
}

export type GetLedgerResult =
  | { outcome: "found"; entries: WalletLedgerEntry[]; nextCursor: string | null }
  | { outcome: "walletNotFound" }
  | { outcome: "invalidCursor" }
  | { outcome: "invalidLimit"; max: number };

// DECISION: limite máximo de 100 por página; protege o banco de varreduras grandes e o
// padrão de 50 do README cabe com folga.
export const LEDGER_PAGE_MAX_LIMIT = 100;

export class GetLedgerUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async execute(input: GetLedgerInput): Promise<GetLedgerResult> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > LEDGER_PAGE_MAX_LIMIT) {
      return { outcome: "invalidLimit", max: LEDGER_PAGE_MAX_LIMIT };
    }
    try {
      return await this.unitOfWork.run(async (repositories) => {
        const wallet = await repositories.wallets.findById(input.walletId);
        if (wallet === null) return { outcome: "walletNotFound" };
        const page = await repositories.ledger.listByWallet({
          walletId: wallet.id,
          currency: wallet.currency,
          cursor: input.cursor,
          limit: input.limit,
        });
        return { outcome: "found", ...page };
      });
    } catch (error) {
      if (error instanceof InvalidLedgerCursorError) return { outcome: "invalidCursor" };
      throw error;
    }
  }
}
