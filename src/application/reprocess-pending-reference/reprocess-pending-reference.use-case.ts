import { FailureCode } from "../../domain/errors/failure-code";
import { InvariantViolationError } from "../../domain/errors/invariant-violation.error";
import type { WagerTransaction } from "../../domain/transaction/wager-transaction";
import type { Clock } from "../ports/clock";
import type { EventContext } from "../ports/event-context";
import type { IdGenerator } from "../ports/id-generator";
import type {
  StoredWagerTransaction,
  WagerTransactionPersistenceState,
} from "../ports/repositories";
import type { RecordedSubmitResult } from "../ports/submit-result";
import type { TransactionalRepositories, UnitOfWork } from "../ports/unit-of-work";
import {
  isPendingReferenceExhausted,
  nextPendingAttemptAt,
} from "../wager-processing/pending-reference-policy";
import { SubmissionEvents } from "../wager-processing/submission-events";
import { processTransaction, rejectTransaction } from "../wager-processing/transaction-processor";

export type ReprocessPendingReferenceResult =
  { outcome: "idle" } | { outcome: "attempted"; result: RecordedSubmitResult };

interface Attempt {
  repositories: TransactionalRepositories;
  stored: StoredWagerTransaction;
  events: SubmissionEvents;
  save(transaction: WagerTransaction, state: WagerTransactionPersistenceState): Promise<void>;
}

export class ReprocessPendingReferenceUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  // DECISION: uma transação por execução, numa transação SQL própria. O worker chama em
  // laço; uma falha afeta só aquela transação e o lock é curto.
  // DECISION: ordem de lock = linha da transação (SKIP LOCKED) e depois a carteira. Não há
  // ciclo com a submissão: ela trava a carteira e nunca trava linhas PENDING_REFERENCE.
  execute(): Promise<ReprocessPendingReferenceResult> {
    return this.unitOfWork.run(async (repositories) => {
      const now = this.clock.now();
      const [stored] = await repositories.transactions.findDuePendingReferenceForUpdateSkipLocked(
        1,
        now,
      );
      if (stored === undefined) return { outcome: "idle" };
      const events = new SubmissionEvents(repositories.outbox, this.ids, contextFor(stored), now);
      const save = (transaction: WagerTransaction, state: WagerTransactionPersistenceState) =>
        repositories.transactions.update(transaction, state);
      const result = await this.attempt({ repositories, stored, events, save });
      return { outcome: "attempted", result };
    });
  }

  private async attempt(attempt: Attempt): Promise<RecordedSubmitResult> {
    const { repositories, stored, events, save } = attempt;
    const { transaction } = stored;
    const wallet = await repositories.wallets.findByIdForUpdate(transaction.walletId);
    // INVARIANT: só vira PENDING_REFERENCE quem já passou pela checagem de carteira.
    if (wallet === null) throw new InvariantViolationError("pending transaction without wallet");
    return processTransaction({
      repositories,
      transaction,
      wallet,
      events,
      save,
      onUnresolvedReference: () => retryLater(attempt),
    });
  }
}

async function retryLater(attempt: Attempt): Promise<RecordedSubmitResult> {
  const { stored, events, save } = attempt;
  const { transaction } = stored;
  const attempts = stored.state.pendingAttempts + 1;
  if (isPendingReferenceExhausted(attempts, transaction.createdAt, events.now)) {
    return rejectTransaction({ transaction, events, save }, FailureCode.REFERENCE_NOT_FOUND, null);
  }
  await save(transaction, {
    resultingBalance: null,
    pendingAttempts: attempts,
    nextAttemptAt: nextPendingAttemptAt(attempts, events.now),
  });
  return { outcome: "pendingReference", transactionId: transaction.id, idempotentReplay: false };
}

// RISK: o correlationId da requisição original não é persistido; os eventos do
// reprocessamento correlacionam pelo id da transação. Persistir o contexto exigiria coluna nova.
function contextFor(stored: StoredWagerTransaction): EventContext {
  return { correlationId: stored.transaction.id, causationId: null };
}
