import { InvalidTransactionStateError } from "../errors/invalid-transaction-state.error";
import { InvariantViolationError } from "../errors/invariant-violation.error";
import type { FailureCode } from "../errors/failure-code";
import type { Money } from "../money/money";
import { LedgerDirection } from "../wallet/wallet-ledger-entry";
import { ReferenceRequiredError } from "./reference-required.error";
import { TransactionKind } from "./transaction-kind";
import { TransactionStatus } from "./transaction-status";

export interface WagerTransactionProps {
  id: string;
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: TransactionKind;
  money: Money;
  referenceExternalTransactionId: string | null;
  payloadHash: string;
  status: TransactionStatus;
  // DECISION: id interno da referência, preenchido só quando ela é resolvida (markProcessed).
  // O payload carrega apenas o id externo do provedor.
  referenceTransactionId: string | null;
  failureCode: FailureCode | null;
  processedAt: Date | null;
  createdAt: Date;
}

type LifecycleField = "status" | "referenceTransactionId" | "failureCode" | "processedAt";

export type CreateWagerTransactionInput = Omit<WagerTransactionProps, LifecycleField>;

export type OpenWagerTransactionInput = Omit<
  WagerTransactionProps,
  LifecycleField | "kind" | "referenceExternalTransactionId"
>;

const KINDS_REQUIRING_REFERENCE: ReadonlySet<TransactionKind> = new Set([
  TransactionKind.REFUND,
  TransactionKind.ROLLBACK,
]);

const DIRECT_DIRECTION: ReadonlyMap<TransactionKind, LedgerDirection> = new Map([
  [TransactionKind.BET, LedgerDirection.DEBIT],
  [TransactionKind.WIN, LedgerDirection.CREDIT],
  [TransactionKind.REFUND, LedgerDirection.CREDIT],
  [TransactionKind.OPENING, LedgerDirection.CREDIT],
]);

// DECISION: ROLLBACK desfaz a referência, então usa a direção inversa dela.
// Só BET, WIN e REFUND podem ser revertidos; o caso de uso rejeita outros com INVALID_REFERENCE_KIND.
const ROLLBACK_DIRECTION: ReadonlyMap<TransactionKind, LedgerDirection> = new Map([
  [TransactionKind.BET, LedgerDirection.CREDIT],
  [TransactionKind.WIN, LedgerDirection.DEBIT],
  [TransactionKind.REFUND, LedgerDirection.DEBIT],
]);

const TERMINAL_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  TransactionStatus.PROCESSED,
  TransactionStatus.REJECTED,
  TransactionStatus.FAILED,
]);

// Tabela de transições:
//   PENDING           -> PROCESSED | PENDING_REFERENCE | REJECTED | FAILED
//   PENDING_REFERENCE -> PROCESSED | REJECTED | FAILED
//   PROCESSED, REJECTED, FAILED são terminais: qualquer transição lança InvalidTransactionStateError.
export class WagerTransaction {
  private constructor(private readonly props: WagerTransactionProps) {}

  // INVARIANT: OPENING nunca vem de HTTP/SQS; só pelo factory interno `opening`.
  static create(input: CreateWagerTransactionInput): WagerTransaction {
    if (input.kind === TransactionKind.OPENING) {
      throw new InvariantViolationError("OPENING cannot be created externally");
    }
    const transaction = WagerTransaction.born(input);
    if (transaction.requiresReference() && input.referenceExternalTransactionId === null) {
      throw new ReferenceRequiredError(input.kind);
    }
    return transaction;
  }

  // DECISION: factory separado para o crédito de abertura, usado só pelo seed interno,
  // para que nenhum caminho externo consiga construir um OPENING.
  static opening(input: OpenWagerTransactionInput): WagerTransaction {
    return WagerTransaction.born({
      ...input,
      kind: TransactionKind.OPENING,
      referenceExternalTransactionId: null,
    });
  }

  // DECISION: rehydrate não revalida; dados vindos do banco já passaram por create.
  static rehydrate(props: WagerTransactionProps): WagerTransaction {
    return new WagerTransaction({
      ...props,
      processedAt: props.processedAt === null ? null : new Date(props.processedAt),
      createdAt: new Date(props.createdAt),
    });
  }

  private static born(input: CreateWagerTransactionInput): WagerTransaction {
    return new WagerTransaction({
      ...input,
      status: TransactionStatus.PENDING,
      referenceTransactionId: null,
      failureCode: null,
      processedAt: null,
      createdAt: new Date(input.createdAt),
    });
  }

  isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this.props.status);
  }

  // DECISION: o id interno da referência só é conhecido quando ela é resolvida,
  // por isso entra aqui e não no create.
  markProcessed(now: Date, referenceTransactionId: string | null): void {
    this.assertNotTerminal("markProcessed");
    this.props.status = TransactionStatus.PROCESSED;
    this.props.referenceTransactionId = referenceTransactionId;
    this.props.processedAt = new Date(now);
  }

  // INVARIANT: PENDING_REFERENCE não volta para si mesmo; só sai para um estado terminal.
  markPendingReference(): void {
    if (this.props.status !== TransactionStatus.PENDING) {
      throw new InvalidTransactionStateError(this.props.status, "markPendingReference");
    }
    this.props.status = TransactionStatus.PENDING_REFERENCE;
  }

  reject(failureCode: FailureCode): void {
    this.assertNotTerminal("reject");
    this.props.status = TransactionStatus.REJECTED;
    this.props.failureCode = failureCode;
  }

  fail(failureCode: FailureCode): void {
    this.assertNotTerminal("fail");
    this.props.status = TransactionStatus.FAILED;
    this.props.failureCode = failureCode;
  }

  private assertNotTerminal(action: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this.props.status, action);
    }
  }

  // INVARIANT: só é chamado quando affectsBalance() é true; LOSS não gera lançamento.
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    const direction =
      this.props.kind === TransactionKind.ROLLBACK
        ? ROLLBACK_DIRECTION.get(reference?.kind ?? this.props.kind)
        : DIRECT_DIRECTION.get(this.props.kind);
    if (direction === undefined) {
      throw new InvariantViolationError(`no ledger direction for ${this.props.kind}`);
    }
    return direction;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.props.payloadHash === payloadHash;
  }

  requiresReference(): boolean {
    return KINDS_REQUIRING_REFERENCE.has(this.props.kind);
  }

  // DECISION: LOSS só registra o fim da rodada; o débito já aconteceu no BET.
  affectsBalance(): boolean {
    return this.props.kind !== TransactionKind.LOSS;
  }

  get id(): string {
    return this.props.id;
  }

  get idempotencyKey(): string {
    return this.props.idempotencyKey;
  }

  get providerId(): string {
    return this.props.providerId;
  }

  get externalTransactionId(): string {
    return this.props.externalTransactionId;
  }

  get playerId(): string {
    return this.props.playerId;
  }

  get walletId(): string {
    return this.props.walletId;
  }

  get roundId(): string {
    return this.props.roundId;
  }

  get gameId(): string {
    return this.props.gameId;
  }

  get kind(): TransactionKind {
    return this.props.kind;
  }

  get money(): Money {
    return this.props.money;
  }

  get referenceExternalTransactionId(): string | null {
    return this.props.referenceExternalTransactionId;
  }

  get payloadHash(): string {
    return this.props.payloadHash;
  }

  get status(): TransactionStatus {
    return this.props.status;
  }

  get referenceTransactionId(): string | null {
    return this.props.referenceTransactionId;
  }

  get failureCode(): FailureCode | null {
    return this.props.failureCode;
  }

  get processedAt(): Date | null {
    return this.props.processedAt === null ? null : new Date(this.props.processedAt);
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt);
  }
}
