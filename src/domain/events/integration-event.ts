export const INTEGRATION_EVENT_VERSION = 1;

// DECISION: type alias em vez de interface para ser atribuível a Record<string, unknown>
// (contrato OutboxEvent.toJSON) sem cast.
export type IntegrationEventJSON<TData> = {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  data: TData;
};

// DECISION: `data` só aceita tipos serializáveis (MoneyJSON com strings), nunca Money.
// O envelope vai para o outbox como JSON; carregar Money arriscaria serialização com perda.
export abstract class IntegrationEvent<TData extends object> {
  abstract readonly eventType: string;
  readonly eventVersion = INTEGRATION_EVENT_VERSION;

  protected constructor(
    readonly eventId: string,
    readonly occurredAt: Date,
    readonly data: Readonly<TData>,
  ) {}

  toJSON(): IntegrationEventJSON<TData> {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      eventVersion: this.eventVersion,
      occurredAt: this.occurredAt.toISOString(),
      data: { ...this.data },
    };
  }
}
