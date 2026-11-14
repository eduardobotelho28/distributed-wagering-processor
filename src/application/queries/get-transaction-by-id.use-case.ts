import type { WagerTransaction } from "../../domain/transaction/wager-transaction";
import type { UnitOfWork } from "../ports/unit-of-work";

export type GetTransactionResult =
  { outcome: "found"; transaction: WagerTransaction } | { outcome: "notFound" };

export class GetTransactionByIdUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async execute(transactionId: string): Promise<GetTransactionResult> {
    const transaction = await this.unitOfWork.run((repositories) =>
      repositories.transactions.findById(transactionId),
    );
    return transaction === null ? { outcome: "notFound" } : { outcome: "found", transaction };
  }
}
