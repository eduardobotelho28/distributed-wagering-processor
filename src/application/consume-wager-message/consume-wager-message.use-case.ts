import { InboxMessage } from "../../domain/inbox/inbox-message";
import { computePayloadHash } from "../../domain/transaction/payload-hash";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { RecordedSubmitResult, SubmitResult } from "../ports/submit-result";
import type { TransactionalRepositories, UnitOfWork } from "../ports/unit-of-work";
import { validateSubmission } from "../submit-wager-transaction/validate-submission";
import {
  runWithRecovery,
  type SubmitWagerTransactionInput,
  WagerSubmission,
} from "../wager-processing/wager-submission";

export interface ConsumeWagerMessageInput {
  consumerName: string;
  messageId: string;
  submission: SubmitWagerTransactionInput;
}

export type ConsumeWagerMessageResult =
  | { outcome: "duplicate" }
  | { outcome: "messageConflict" }
  | { outcome: "handled"; result: SubmitResult };

export class ConsumeWagerMessageUseCase {
  private readonly submission: WagerSubmission;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    ids: IdGenerator,
  ) {
    this.submission = new WagerSubmission(clock, ids);
  }

  // DECISION: payload inválido não passa pelo inbox; nada é gravado e o consumidor manda a
  // mensagem para a DLQ (falha permanente). Gravar no inbox esconderia o erro em reentregas.
  async execute(input: ConsumeWagerMessageInput): Promise<ConsumeWagerMessageResult> {
    const invalidPayload = validateSubmission(input.submission);
    if (invalidPayload !== null) return { outcome: "handled", result: invalidPayload };
    return runWithRecovery(
      this.unitOfWork,
      this.submission,
      input.submission,
      (repositories, step) => this.withInbox(repositories, input, step),
    );
  }

  // INVARIANT: inbox, efeito financeiro, outbox e markProcessed na MESMA transação SQL. Se o
  // processo morrer antes do commit, nada fica e a reentrega processa do zero; depois do
  // commit, a reentrega cai no inbox e vira "duplicate" sem efeito.
  // INVARIANT: a dedup é a PK (consumer_name, message_id) do banco, nunca memória.
  private async withInbox(
    repositories: TransactionalRepositories,
    input: ConsumeWagerMessageInput,
    step: () => Promise<RecordedSubmitResult>,
  ): Promise<ConsumeWagerMessageResult> {
    const message = InboxMessage.receive({
      consumerName: input.consumerName,
      messageId: input.messageId,
      payloadHash: computePayloadHash(input.submission),
      receivedAt: this.clock.now(),
    });
    // DECISION: como inbox e processamento commitam juntos, "já existe" sempre significa "já
    // processado"; não há estado intermediário a retomar.
    if (!(await repositories.inbox.tryInsert(message))) {
      return this.duplicateOrConflict(repositories, message);
    }
    const result = await step();
    message.markProcessed(this.clock.now());
    await repositories.inbox.markProcessed(message);
    return { outcome: "handled", result };
  }

  // DECISION: mesmo messageId com outro payload não é reentrega, é o produtor reaproveitando o
  // id; vai para a DLQ como conflito em vez de ser confirmado em silêncio. Nada é gravado.
  private async duplicateOrConflict(
    repositories: TransactionalRepositories,
    message: InboxMessage,
  ): Promise<ConsumeWagerMessageResult> {
    const stored = await repositories.inbox.find(message.consumerName, message.messageId);
    if (stored === null || stored.matchesPayload(message.payloadHash)) {
      return { outcome: "duplicate" };
    }
    return { outcome: "messageConflict" };
  }
}
