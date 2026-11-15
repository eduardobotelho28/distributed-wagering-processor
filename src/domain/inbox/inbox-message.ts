import { InvariantViolationError } from "../errors/invariant-violation.error";

export interface InboxMessageProps {
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface ReceiveInboxMessageInput {
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
}

// INVARIANT: (consumerName, messageId) é único; o banco garante com a PK inbox_messages_pkey.
// A deduplicação depende do banco, nunca desta entidade em memória.
export class InboxMessage {
  private constructor(private props: InboxMessageProps) {}

  static receive(input: ReceiveInboxMessageInput): InboxMessage {
    return new InboxMessage({
      ...input,
      receivedAt: new Date(input.receivedAt),
      processedAt: null,
    });
  }

  // DECISION: rehydrate não revalida; dados vindos do banco já passaram por receive.
  static rehydrate(props: InboxMessageProps): InboxMessage {
    return new InboxMessage({ ...props });
  }

  isProcessed(): boolean {
    return this.props.processedAt !== null;
  }

  markProcessed(now: Date): void {
    if (this.isProcessed()) {
      throw new InvariantViolationError("inbox message already processed");
    }
    this.props = { ...this.props, processedAt: new Date(now) };
  }

  get consumerName(): string {
    return this.props.consumerName;
  }

  get messageId(): string {
    return this.props.messageId;
  }

  get payloadHash(): string {
    return this.props.payloadHash;
  }

  get receivedAt(): Date {
    return new Date(this.props.receivedAt);
  }

  get processedAt(): Date | null {
    return this.props.processedAt === null ? null : new Date(this.props.processedAt);
  }
}
