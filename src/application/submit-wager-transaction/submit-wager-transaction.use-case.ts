import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { SubmitResult } from "../ports/submit-result";
import type { UnitOfWork } from "../ports/unit-of-work";
import {
  runWithRecovery,
  type SubmitWagerTransactionInput,
  WagerSubmission,
} from "../wager-processing/wager-submission";
import { validateSubmission } from "./validate-submission";

export type { SubmitWagerTransactionInput };

export class SubmitWagerTransactionUseCase {
  private readonly submission: WagerSubmission;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    clock: Clock,
    ids: IdGenerator,
  ) {
    this.submission = new WagerSubmission(clock, ids);
  }

  async execute(input: SubmitWagerTransactionInput): Promise<SubmitResult> {
    const invalidPayload = validateSubmission(input);
    if (invalidPayload !== null) return invalidPayload;
    return runWithRecovery(this.unitOfWork, this.submission, input, (_repositories, step) =>
      step(),
    );
  }
}
