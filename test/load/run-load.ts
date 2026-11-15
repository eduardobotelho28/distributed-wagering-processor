// Teste de carga (T101). Não é um `bun test`: roda com `bun run test:load` e imprime um
// relatório em Markdown. Sobe instâncias reais do app contra um banco e uma fila descartáveis.
import { cpus, totalmem } from "node:os";
import { CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import { loadConfig } from "../../src/infrastructure/config/app-config";
import { createSqsClient } from "../../src/infrastructure/messaging/sqs-client";
import { SqsMessageQueue } from "../../src/infrastructure/messaging/sqs-message-queue";
import { OutboxMessageSchema } from "../../src/infrastructure/persistence/models/outbox-message.model";
import { waitFor } from "../support/app-process";
import { type Cluster, type ClusterInstance, startCluster } from "../support/cluster";
import { bet, createWallet } from "../support/cluster-scenario";
import { assertLedgerInvariant } from "../support/ledger-invariant";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

interface LoadSettings {
  instances: number;
  concurrency: number;
  spreadSeconds: number;
  hotSeconds: number;
  wallets: number;
  outboxIntervalMs: number;
  outboxBatchSize: number;
}

function readSettings(): LoadSettings {
  const read = (name: string, fallback: number) => {
    const raw = process.env[name];
    return raw !== undefined && /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : fallback;
  };
  return {
    instances: read("LOAD_INSTANCES", 3),
    concurrency: read("LOAD_CONCURRENCY", 50),
    spreadSeconds: read("LOAD_SPREAD_SECONDS", 20),
    hotSeconds: read("LOAD_HOT_SECONDS", 10),
    wallets: read("LOAD_WALLETS", 200),
    // Padrões iguais aos do app (OUTBOX_PUBLISH_INTERVAL_MS / OUTBOX_BATCH_SIZE).
    outboxIntervalMs: read("LOAD_OUTBOX_INTERVAL_MS", 1000),
    outboxBatchSize: read("LOAD_OUTBOX_BATCH_SIZE", 50),
  };
}

interface Sample {
  latencyMs: number;
  outcome: "ok" | "rejected" | "error";
}

interface ScenarioResult {
  name: string;
  seconds: number;
  samples: Sample[];
  lockConflicts: number;
  outboxLag: LagStats;
  startedAt: Date;
}

interface LagStats {
  events: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

// --- geração de carga -------------------------------------------------------------------

function classify(status: number): Sample["outcome"] {
  if (status === 200 || status === 201) return "ok";
  if (status === 422) return "rejected";
  return "error";
}

async function timedBet(instance: ClusterInstance, walletId: string): Promise<Sample> {
  const started = performance.now();
  try {
    const reply = await bet(instance, {
      walletId,
      externalTransactionId: crypto.randomUUID(),
      amount: "1.00",
    });
    return { latencyMs: performance.now() - started, outcome: classify(reply.status) };
  } catch {
    return { latencyMs: performance.now() - started, outcome: "error" };
  }
}

// DECISION: usuários virtuais em laço fechado (cada um envia a próxima só depois da resposta).
// Mede a capacidade do sistema sob N clientes simultâneos, sem enfileirar requisições do lado
// do gerador como um laço aberto de taxa fixa faria.
async function virtualUser(
  cluster: Cluster,
  pickWallet: () => string,
  deadline: number,
  samples: Sample[],
): Promise<void> {
  while (performance.now() < deadline) {
    samples.push(await timedBet(cluster.next(), pickWallet()));
  }
}

// --- medições ---------------------------------------------------------------------------

async function lockConflicts(cluster: Cluster): Promise<number> {
  let total = 0;
  for (const instance of cluster.instances) {
    const text = await (await fetch(`${instance.baseUrl}/metrics`)).text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("lock_conflicts_total{")) continue;
      total += Number.parseInt(line.slice(line.lastIndexOf(" ") + 1), 10);
    }
  }
  return total;
}

async function outboxLag(db: TestDatabase, from: Date, to: Date): Promise<LagStats> {
  const rows = await db.orm.em
    .getConnection()
    .execute<{ events: number; p50: number; p95: number; p99: number; max: number }[]>(
      `select count(*)::int as events,
       percentile_cont(0.50) within group (order by lag) as p50,
       percentile_cont(0.95) within group (order by lag) as p95,
       percentile_cont(0.99) within group (order by lag) as p99,
       max(lag)::float8 as max
     from (select (extract(epoch from published_at - occurred_at) * 1000)::float8 as lag
           from outbox_messages where occurred_at >= ? and occurred_at < ?) as lags`,
      [from, to],
    );
  const row = rows[0];
  if (row === undefined) throw new Error("no lag row");
  return row;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

// --- cenários ---------------------------------------------------------------------------

async function runScenario(
  context: { cluster: Cluster; db: TestDatabase; settings: LoadSettings },
  scenario: { name: string; seconds: number; pickWallet: () => string },
): Promise<ScenarioResult> {
  const { cluster, db, settings } = context;
  const conflictsBefore = await lockConflicts(cluster);
  const startedAt = new Date();
  const deadline = performance.now() + scenario.seconds * 1000;
  const samples: Sample[] = [];
  await Promise.all(
    Array.from({ length: settings.concurrency }, () =>
      virtualUser(cluster, scenario.pickWallet, deadline, samples),
    ),
  );
  const endedAt = new Date();
  await waitFor(
    async () => (await db.orm.em.fork().count(OutboxMessageSchema, { publishedAt: null })) === 0,
    120_000,
  );
  return {
    name: scenario.name,
    seconds: (endedAt.getTime() - startedAt.getTime()) / 1000,
    samples,
    lockConflicts: (await lockConflicts(cluster)) - conflictsBefore,
    outboxLag: await outboxLag(db, startedAt, endedAt),
    startedAt,
  };
}

// --- relatório --------------------------------------------------------------------------

const fmt = (value: number, digits = 1) =>
  value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

function reportRow(result: ScenarioResult): string {
  const latencies = result.samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const count = (outcome: Sample["outcome"]) =>
    result.samples.filter((sample) => sample.outcome === outcome).length;
  const total = result.samples.length;
  const cells = [
    result.name,
    total,
    fmt(total / result.seconds),
    fmt(percentile(latencies, 50)),
    fmt(percentile(latencies, 95)),
    fmt(percentile(latencies, 99)),
    `${fmt((count("error") / total) * 100, 2)}%`,
    count("rejected"),
    result.lockConflicts,
    `${fmt(result.outboxLag.p50)} / ${fmt(result.outboxLag.p95)} / ${fmt(result.outboxLag.p99)} / ${fmt(result.outboxLag.max)}`,
  ];
  return `| ${cells.join(" | ")} |`;
}

function report(
  settings: LoadSettings,
  results: ScenarioResult[],
  invariantWallets: number,
): string {
  return [
    "## Ambiente da execução",
    "",
    `- Bun ${Bun.version}, ${cpus().length} vCPUs, ${fmt(totalmem() / 1024 ** 3)} GiB visíveis no container`,
    `- ${settings.instances} instâncias do app, ${settings.concurrency} usuários virtuais`,
    `- carteiras espalhadas: ${settings.wallets} carteiras por ${settings.spreadSeconds}s; carteira concorrida: ${settings.hotSeconds}s`,
    `- publisher do outbox: rodada a cada ${settings.outboxIntervalMs}ms, lote de ${settings.outboxBatchSize}`,
    "",
    "## Resultados",
    "",
    "| Cenário | Requisições | Req/s | p50 ms | p95 ms | p99 ms | Erros | Rejeições 422 | Conflitos de lock | Lag do outbox p50/p95/p99/máx ms |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...results.map(reportRow),
    "",
    `Invariante do ledger conferido em ${invariantWallets} carteiras: OK.`,
  ].join("\n");
}

// --- execução ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const settings = readSettings();
  const db = await createTestDatabase();
  const client = createSqsClient(loadConfig(process.env).sqs);
  const eventsQueue = `load-events-${crypto.randomUUID()}`;
  await client.send(new CreateQueueCommand({ QueueName: eventsQueue }));
  const cluster = await startCluster(settings.instances, {
    DATABASE_URL: db.url,
    SQS_EVENTS_QUEUE: eventsQueue,
    BACKGROUND_WORKERS_ENABLED: "true",
    OUTBOX_PUBLISH_INTERVAL_MS: String(settings.outboxIntervalMs),
    OUTBOX_BATCH_SIZE: String(settings.outboxBatchSize),
  });
  try {
    const wallets = await Promise.all(
      Array.from({ length: settings.wallets }, () => createWallet(cluster.next(), "1000000.00")),
    );
    const hot = await createWallet(cluster.next(), "1000000.00");
    const context = { cluster, db, settings };
    const results = [
      await runScenario(context, {
        name: "carteiras espalhadas",
        seconds: settings.spreadSeconds,
        pickWallet: () => wallets[Math.floor(Math.random() * wallets.length)] ?? hot,
      }),
      await runScenario(context, {
        name: "carteira concorrida",
        seconds: settings.hotSeconds,
        pickWallet: () => hot,
      }),
    ];
    for (const walletId of [...wallets, hot])
      await assertLedgerInvariant(db.orm.em.fork(), walletId);
    console.log(report(settings, results, wallets.length + 1));
  } finally {
    await cluster.stop();
    await client.send(
      new DeleteQueueCommand({ QueueUrl: await new SqsMessageQueue(client).urlOf(eventsQueue) }),
    );
    await db.dispose();
  }
}

await main();
