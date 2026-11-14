import { InvariantViolationError } from "../errors/invariant-violation.error";
import type { FailureCode } from "../errors/failure-code";
import type { Money } from "../money/money";
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
