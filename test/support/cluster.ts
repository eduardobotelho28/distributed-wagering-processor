import { startAppProcess, waitFor } from "./app-process";

export interface ClusterInstance {
  baseUrl: string;
  stop(): Promise<void>;
  // SIGKILL: sem shutdown gracioso, como uma queda de máquina.
  kill(): Promise<void>;
}

export interface Cluster {
  instances: ClusterInstance[];
  // Distribui as chamadas em rodízio entre as instâncias.
  next(): ClusterInstance;
  stop(): Promise<void>;
  kill(): Promise<void>;
}

export interface HttpResult {
  status: number;
  body: unknown;
}

const BOOT_TIMEOUT_MS = 30_000;
let portCursor = 21_000 + Math.floor(Math.random() * 10_000);

async function isReady(baseUrl: string): Promise<boolean> {
  try {
    const reply = await fetch(`${baseUrl}/health/ready`);
    return reply.status === 200;
  } catch {
    return false;
  }
}

async function startInstance(env: Record<string, string>): Promise<ClusterInstance> {
  portCursor += 1;
  const port = portCursor;
  const child = startAppProcess({ ...env, APP_PORT: String(port) });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(() => isReady(baseUrl), BOOT_TIMEOUT_MS);
  return {
    baseUrl,
    async stop() {
      child.kill("SIGTERM");
      await child.exited;
    },
    async kill() {
      child.kill("SIGKILL");
      await child.exited;
    },
  };
}

// DECISION: N processos Bun independentes (não compose scale) contra o mesmo Postgres e
// LocalStack; cada um tem seu pool de conexões, seu event loop e seus workers, exatamente
// como réplicas reais. O teste não compartilha memória com elas.
export async function startCluster(size: number, env: Record<string, string>): Promise<Cluster> {
  const instances = await Promise.all(Array.from({ length: size }, () => startInstance(env)));
  let cursor = 0;
  return {
    instances,
    next() {
      const instance = instances[cursor % instances.length];
      cursor += 1;
      if (instance === undefined) throw new Error("empty cluster");
      return instance;
    },
    async stop() {
      await Promise.all(instances.map((instance) => instance.stop()));
    },
    async kill() {
      await Promise.all(instances.map((instance) => instance.kill()));
    },
  };
}

export async function postJson(
  instance: ClusterInstance,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  const reply = await fetch(`${instance.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await reply.text();
  return { status: reply.status, body: text === "" ? null : JSON.parse(text) };
}

export async function getJson(instance: ClusterInstance, path: string): Promise<HttpResult> {
  const reply = await fetch(`${instance.baseUrl}${path}`);
  return { status: reply.status, body: await reply.json() };
}
