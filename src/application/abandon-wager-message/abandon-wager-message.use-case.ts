import { InboxMessage } from "../../domain/inbox/inbox-message";
import { computePayloadHash } from "../../domain/transaction/payload-hash";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { RecordedSubmitResult } from "../ports/submit-result";
import type { UnitOfWork } from "../ports/unit-of-work";
import type { ConsumeWagerMessageInput } from "../consume-wager-message/consume-wager-message.use-case";
import { WagerSubmission } from "../wager-processing/wager-submission";

export type AbandonWagerMessageResult =
  { outcome: "alreadyHandled" } | { outcome: "recorded"; result: RecordedSubmitResult };

// DECISION: quando as tentativas transitórias se esgotam e a identidade da transação é
// conhecida, gravamos FAILED (INTERNAL_PERMANENT_ERROR) para a operação ficar auditável e o
// replay do provedor ter resposta terminal, em vez de sumir só na DLQ.
// INVARIANT: mesma transação SQL com o inbox; se a mensagem já foi processada, nada muda.
export class AbandonWagerMessageUseCase {
  private readonly submission: WagerSubmission;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    ids: IdGenerator,
  ) {
    this.submission = new WagerSubmission(clock, ids);
  }

  execute(input: ConsumeWagerMessageInput): Promise<AbandonWagerMessageResult> {
    return this.unitOfWork.run(async (repositories) => {
      const message = InboxMessage.receive({
        consumerName: input.consumerName,
        messageId: input.messageId,
        payloadHash: computePayloadHash(input.submission),
        receivedAt: this.clock.now(),
      });
      if (!(await repositories.inbox.tryInsert(message))) return { outcome: "alreadyHandled" };
      const result = await this.submission.recordFailure(repositories, input.submission);
      message.markProcessed(this.clock.now());
      await repositories.inbox.markProcessed(message);
      return { outcome: "recorded", result };
    });
  }
}
