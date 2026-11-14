import type { FailureCode } from "../../domain/errors/failure-code";
import type { EventOrigin } from "../../domain/events/integration-event";
import { WagerTransactionPendingReference } from "../../domain/events/wager-transaction-pending-reference.event";
import { WagerTransactionProcessed } from "../../domain/events/wager-transaction-processed.event";
import { WagerTransactionRejected } from "../../domain/events/wager-transaction-rejected.event";
import { WalletBalanceChanged } from "../../domain/events/wallet-balance-changed.event";
import type { Money } from "../../domain/money/money";
import { type OutboxEvent, OutboxMessage } from "../../domain/outbox/outbox-message";
import type { WagerTransaction } from "../../domain/transaction/wager-transaction";
import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import type { EventContext } from "../ports/event-context";
import type { IdGenerator } from "../ports/id-generator";
import type { OutboxRepositoryPort } from "../ports/repositories";

// INVARIANT: todo evento é gravado no outbox pelo mesmo repositório da transação SQL da
// submissão; nada é publicado antes do commit (o publisher lê o outbox depois).
// DECISION: replay e conflito de idempotência não emitem eventos; eles já foram emitidos
// na primeira vez, e reenviar duplicaria efeitos nos consumidores.
export class SubmissionEvents {
  constructor(
    private readonly outbox: OutboxRepositoryPort,
    private readonly ids: IdGenerator,
    private readonly context: EventContext,
    readonly now: Date,
  ) {}

  // Inclui LOSS: toda transação aplicada gera Processed, mesmo sem mover saldo.
  processed(transaction: WagerTransaction, resultingBalance: Money): Promise<void> {
    return this.enqueue(
      WagerTransactionProcessed.create({
        ...this.origin(),
        transactionId: transaction.id,
        walletId: transaction.walletId,
        kind: transaction.kind,
        amount: transaction.money,
        resultingBalance,
      }),
    );
  }

  // INVARIANT: só é chamado quando há lançamento; LOSS e rejeições nunca mudam o saldo.
  balanceChanged(entry: WalletLedgerEntry): Promise<void> {
    return this.enqueue(
      WalletBalanceChanged.create({
        ...this.origin(),
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        balanceBefore: entry.balanceBefore,
        balanceAfter: entry.balanceAfter,
      }),
    );
  }

  rejected(transaction: WagerTransaction, failureCode: FailureCode): Promise<void> {
    return this.enqueue(
      WagerTransactionRejected.create({
        ...this.origin(),
        transactionId: transaction.id,
        walletId: transaction.walletId,
        kind: transaction.kind,
        amount: transaction.money,
        failureCode,
      }),
    );
  }

  pendingReference(transaction: WagerTransaction, referenceExternalId: string): Promise<void> {
    return this.enqueue(
      WagerTransactionPendingReference.create({
        ...this.origin(),
        transactionId: transaction.id,
        walletId: transaction.walletId,
        kind: transaction.kind,
        amount: transaction.money,
        referenceExternalTransactionId: referenceExternalId,
      }),
    );
  }

  private origin(): EventOrigin {
    return {
      eventId: this.ids.next(),
      occurredAt: this.now,
      correlationId: this.context.correlationId,
      causationId: this.context.causationId,
    };
  }

  private enqueue(event: OutboxEvent): Promise<void> {
    return this.outbox.insert(OutboxMessage.enqueue(event));
  }
}
