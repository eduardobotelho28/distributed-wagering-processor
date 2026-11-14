import type { Wallet } from "../../domain/wallet/wallet";
import type { UnitOfWork } from "../ports/unit-of-work";

export type GetWalletResult = { outcome: "found"; wallet: Wallet } | { outcome: "notFound" };

export class GetWalletUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async execute(walletId: string): Promise<GetWalletResult> {
    const wallet = await this.unitOfWork.run((repositories) =>
      repositories.wallets.findById(walletId),
    );
    return wallet === null ? { outcome: "notFound" } : { outcome: "found", wallet };
  }
}
