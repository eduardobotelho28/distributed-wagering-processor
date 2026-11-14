import { expect, test } from "bun:test";

test("app refuses to boot when a required var is missing", async () => {
  // DECISION: Bun auto-loads .env from cwd, so removing the var is not enough. A blank
  // value wins over .env and is treated as missing by loadConfig.
  const child = Bun.spawn(["bun", "src/main.ts"], {
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: "" },
    timeout: 4000,
    stdout: "ignore",
    stderr: "pipe",
  });

  const exitCode = await child.exited;
  const stderr = await new Response(child.stderr).text();

  expect(exitCode).toBe(1);
  expect(stderr).toContain("DATABASE_URL is required");
});
