import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Cluster, getJson, startCluster } from "../support/cluster";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

let db: TestDatabase;
let cluster: Cluster;

beforeAll(async () => {
  db = await createTestDatabase();
  cluster = await startCluster(3, { DATABASE_URL: db.url });
}, 60_000);

afterAll(async () => {
  await cluster.stop();
  await db.dispose();
}, 60_000);

describe("multi-instance harness", () => {
  test("boots 3 independent instances that are all ready", async () => {
    const ports = new Set(cluster.instances.map((instance) => instance.baseUrl));
    const readiness = await Promise.all(
      cluster.instances.map((instance) => getJson(instance, "/health/ready")),
    );

    expect(ports.size).toBe(3);
    expect(readiness.map((reply) => reply.status)).toEqual([200, 200, 200]);
  });

  test("distributes calls round-robin across instances", () => {
    const picked = [1, 2, 3, 4, 5, 6].map(() => cluster.next().baseUrl);

    expect(new Set(picked.slice(0, 3)).size).toBe(3);
    expect(picked.slice(3)).toEqual(picked.slice(0, 3));
  });
});
