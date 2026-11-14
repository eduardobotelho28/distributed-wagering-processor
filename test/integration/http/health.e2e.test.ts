import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import { loadConfig } from "../../../src/infrastructure/config/app-config";
import { SqsHealthCheck } from "../../../src/infrastructure/health/sqs-health-check";
import { buildMikroOrmOptions } from "../../../src/infrastructure/persistence/mikro-orm.config";
import { type HttpTestApp, startHttpApp } from "../../support/http-app";

let app: HttpTestApp;
let admin: MikroORM;

beforeAll(async () => {
  app = await startHttpApp();
  admin = await MikroORM.init(buildMikroOrmOptions(loadConfig(process.env).database.url));
});

afterAll(async () => {
  await setConnectionsAllowed(true);
  await admin.close();
  await app.close();
});

function databaseName(): string {
  return new URL(app.db.url).pathname.slice(1);
}

// Derruba o Postgres do ponto de vista desta instância: recusa conexões novas ao banco do
// teste e encerra as abertas, sem tocar no Postgres compartilhado pelas outras suítes.
async function setConnectionsAllowed(allowed: boolean): Promise<void> {
  const connection = admin.em.getConnection();
  await connection.execute(`alter database ${databaseName()} allow_connections ${allowed}`);
  if (allowed) return;
  await connection.execute(
    "select pg_terminate_backend(pid) from pg_stat_activity where datname = ? and pid <> pg_backend_pid()",
    [databaseName()],
  );
}

describe("health endpoints", () => {
  test("live and ready are 200 when Postgres and SQS are reachable", async () => {
    const live = await app.request("GET", "/health/live");
    const ready = await app.request("GET", "/health/ready");

    expect(live.status).toBe(200);
    expect(live.body).toEqual({ status: "alive" });
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: "ready", checks: { database: "up", sqs: "up" } });
  });

  test("ready is 503 and live stays 200 while Postgres is down, then recovers", async () => {
    await setConnectionsAllowed(false);

    const ready = await app.request("GET", "/health/ready");
    const live = await app.request("GET", "/health/live");

    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: "not_ready", checks: { database: "down", sqs: "up" } });
    expect(live.status).toBe(200);

    await setConnectionsAllowed(true);
    const recovered = await app.request("GET", "/health/ready");
    expect(recovered.status).toBe(200);
  });

  test("the SQS check reports down for an unreachable endpoint", async () => {
    expect(await new SqsHealthCheck("http://127.0.0.1:1").check()).toBe("down");
  });
});
