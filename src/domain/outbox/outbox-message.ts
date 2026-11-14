import { InvariantViolationError } from "../errors/invariant-violation.error";

// DECISION: structural shape instead of importing IntegrationEvent (T29). Any event
// exposing these fields can be enqueued; the outbox stores the serialized envelope.
export interface OutboxEvent {
  eventId: string;
  eventType: string;
  occurredAt: Date;
  toJSON(): Record<string, unknown>;
}

export interface OutboxMessageProps {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
  nextAttemptAt: Date;
  publishedAt: Date | null;
}

// DECISION: exponential backoff 1s, 2s, 4s... capped at 5 min. Doubling spreads retries
// during an SQS outage; the cap keeps a recovered broker from waiting too long.
export const OUTBOX_BACKOFF_BASE_MS = 1_000;
export const OUTBOX_BACKOFF_CAP_MS = 300_000;

export class OutboxMessage {
  private constructor(private props: OutboxMessageProps) {}

  static enqueue(event: OutboxEvent): OutboxMessage {
    return new OutboxMessage({
      id: event.eventId,
      eventType: event.eventType,
      payload: event.toJSON(),
      attempts: 0,
      nextAttemptAt: new Date(event.occurredAt),
      publishedAt: null,
    });
  }

  static rehydrate(props: OutboxMessageProps): OutboxMessage {
    return new OutboxMessage({ ...props });
  }

  isPending(): boolean {
    return this.props.publishedAt === null;
  }

  isDue(now: Date): boolean {
    return this.isPending() && this.props.nextAttemptAt.getTime() <= now.getTime();
  }

  markPublished(now: Date): void {
    this.assertPending();
    this.props = { ...this.props, publishedAt: new Date(now) };
  }

  scheduleRetry(now: Date): void {
    this.assertPending();
    const attempts = this.props.attempts + 1;
    const delay = Math.min(OUTBOX_BACKOFF_BASE_MS * 2 ** (attempts - 1), OUTBOX_BACKOFF_CAP_MS);
    this.props = { ...this.props, attempts, nextAttemptAt: new Date(now.getTime() + delay) };
  }

  private assertPending(): void {
    if (!this.isPending()) {
      throw new InvariantViolationError("outbox message already published");
    }
  }

  get id(): string {
    return this.props.id;
  }

  get eventType(): string {
    return this.props.eventType;
  }

  get payload(): Record<string, unknown> {
    return { ...this.props.payload };
  }

  get attempts(): number {
    return this.props.attempts;
  }

  get nextAttemptAt(): Date {
    return new Date(this.props.nextAttemptAt);
  }

  get publishedAt(): Date | null {
    return this.props.publishedAt === null ? null : new Date(this.props.publishedAt);
  }
}
