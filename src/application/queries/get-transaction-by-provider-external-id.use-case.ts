import type { UnitOfWork } from "../ports/unit-of-work";
import type { GetTransactionResult } from "./get-transaction-by-id.use-case";

export interface GetTransactionByProviderExternalIdInput {
  providerId: string;
  externalTransactionId: string;
}

export class GetTransactionByProviderExternalIdUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async execute(input: GetTransactionByProviderExternalIdInput): Promise<GetTransactionResult> {
    const transaction = await this.unitOfWork.run((repositories) =>
      repositories.transactions.findByProviderAndExternalId(
        input.providerId,
        input.externalTransactionId,
      ),
    );
    return transaction === null ? { outcome: "notFound" } : { outcome: "found", transaction };
  }
}
