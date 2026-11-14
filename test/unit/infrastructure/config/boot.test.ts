import { expect, test } from "bun:test";

// aqui decido realizar um teste unitário para garantir que o processo falha rápido quando uma variável obrigatória está ausente. Neste caso, estamos testando a variável DATABASE_URL vindo do .env. (porém forçamos a variável a ser vazia para simular o erro).

test("app refuses to boot when a required var is missing", async () => {
  
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
