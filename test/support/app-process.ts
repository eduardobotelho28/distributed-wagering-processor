import type { Subprocess } from "bun";

// Sobe o app de verdade (`bun src/main.ts`) como processo filho, com overrides de env. Usado
// pelos testes que precisam de SIGTERM real ou de várias instâncias disputando o mesmo banco.
export function startAppProcess(
  env: Record<string, string>,
): Subprocess<"ignore", "ignore", "pipe"> {
  return Bun.spawn(["bun", "src/main.ts"], {
    env: {
      ...process.env,
      APP_PORT: String(20_000 + Math.floor(Math.random() * 20_000)),
      SQS_CONSUMER_ENABLED: "false",
      BACKGROUND_WORKERS_ENABLED: "false",
      ...env,
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
}

export async function waitFor(condition: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await Bun.sleep(50);
  }
}
