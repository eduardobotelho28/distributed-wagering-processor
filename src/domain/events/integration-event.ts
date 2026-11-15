// DECISION: type alias em vez de interface para ser atribuível a Record<string, unknown>
// (contrato OutboxEvent.toJSON) sem cast.
export type IntegrationEventJSON<TData> = {
  eventId: string;
  eventType: string;
  version: number;
  aggregateId: string;
  correlationId: string;
  causationId: string | null;
  occurredAt: string;
  data: TData;
};

// Origem comum a todo evento: quem chama informa id, instante e rastreio; o aggregateId é
// derivado por cada evento concreto (transação ou carteira).
export interface EventOrigin {
  eventId: string;
  occurredAt: Date;
  correlationId: string;
  causationId: string | null;
}

export interface EventMetadata extends EventOrigin {
  aggregateId: string;
}

// DECISION: `data` só aceita tipos serializáveis (MoneyJSON com strings), nunca Money.
// O envelope vai para o outbox como JSON; carregar Money arriscaria serialização com perda.
export abstract class IntegrationEvent<TData extends object> {
  // DECISION: tipo e versão ficam na subclasse concreta, não numa string solta no call site;
  // mudar o formato de `data` de um evento é subir a versão só dele.
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly occurredAt: Date;
  readonly aggregateId: string;
  readonly correlationId: string;
  // DECISION: causationId nulo em vez de ausente; o consumidor sempre encontra a chave e
  // distingue "sem causa" (requisição HTTP) de um campo esquecido.
  readonly causationId: string | null;

  protected constructor(
    metadata: EventMetadata,
    readonly data: Readonly<TData>,
  ) {
    this.eventId = metadata.eventId;
    this.occurredAt = new Date(metadata.occurredAt);
    this.aggregateId = metadata.aggregateId;
    this.correlationId = metadata.correlationId;
    this.causationId = metadata.causationId;
  }

  toJSON(): IntegrationEventJSON<TData> {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      version: this.version,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt.toISOString(),
      data: { ...this.data },
    };
  }
}
