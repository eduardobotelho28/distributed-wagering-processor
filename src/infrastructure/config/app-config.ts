export interface AppConfig {
  readonly port: number;
  readonly database: { readonly url: string };
  readonly sqs: {
    readonly region: string;
    readonly endpoint: string;
    readonly transactionsQueue: string;
    readonly transactionsDlq: string;
    readonly eventsQueue: string;
  };
  readonly workers: {
    readonly outboxPublishIntervalMs: number;
    readonly pendingReferenceIntervalMs: number;
  };
  readonly limits: {
    readonly outboxBatchSize: number;
    readonly pendingReferenceBatchSize: number;
    readonly sqsMaxMessages: number;
  };
}

export type Environment = Readonly<Record<string, string | undefined>>;

const MAX_TCP_PORT = 65535;
const SQS_MAX_MESSAGES_PER_RECEIVE = 10;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

export class ConfigValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigValidationError";
  }
}

// decisão: qualquer problema de configuração é reportado de uma vez, para que a primeira tentativa de boot liste todas as variáveis inválidas. As mensagens nomeiam a variável, mas nunca ecoam seu valor (DATABASE_URL tem uma senha).

class EnvironmentReader {
  private readonly problems: string[] = [];

  constructor(private readonly env: Environment) {}

  requiredString(name: string): string {
    const value = this.env[name]?.trim();
    if (!value) {
      this.problems.push(`${name} is required`);
      return "";
    }
    return value;
  }

  requiredUrl(name: string): string {
    const value = this.requiredString(name);
    if (value && !URL.canParse(value)) {
      this.problems.push(`${name} must be a valid URL`);
    }
    return value;
  }

  positiveInteger(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
    const raw = this.env[name]?.trim();
    if (!raw) {
      return fallback;
    }
    const value = POSITIVE_INTEGER.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isSafeInteger(value) || value > max) {
      this.problems.push(`${name} must be an integer between 1 and ${max}`);
      return fallback;
    }
    return value;
  }

  assertValid(): void {
    if (this.problems.length > 0) {
      throw new ConfigValidationError(this.problems);
    }
  }
}

// decisão: as string de conexão (DB, SQS) são obrigatórias e falham rápido; os ajustes (intervalos, tamanhos de lote) têm valores padrão seguros para que um .env mínimo ainda funcione.

export function loadConfig(env: Environment): AppConfig {
  const read = new EnvironmentReader(env);
  const config: AppConfig = {
    port: read.positiveInteger("APP_PORT", 3000, MAX_TCP_PORT),
    database: { url: read.requiredUrl("DATABASE_URL") },
    sqs: {
      region: read.requiredString("AWS_REGION"),
      endpoint: read.requiredUrl("SQS_ENDPOINT"),
      transactionsQueue: read.requiredString("SQS_TRANSACTIONS_QUEUE"),
      transactionsDlq: read.requiredString("SQS_TRANSACTIONS_DLQ"),
      eventsQueue: read.requiredString("SQS_EVENTS_QUEUE"),
    },
    workers: {
      outboxPublishIntervalMs: read.positiveInteger("OUTBOX_PUBLISH_INTERVAL_MS", 1000),
      pendingReferenceIntervalMs: read.positiveInteger("PENDING_REFERENCE_INTERVAL_MS", 5000),
    },
    limits: {
      outboxBatchSize: read.positiveInteger("OUTBOX_BATCH_SIZE", 50),
      pendingReferenceBatchSize: read.positiveInteger("PENDING_REFERENCE_BATCH_SIZE", 50),
      sqsMaxMessages: read.positiveInteger("SQS_MAX_MESSAGES", 10, SQS_MAX_MESSAGES_PER_RECEIVE),
    },
  };
  read.assertValid();
  return config;
}
