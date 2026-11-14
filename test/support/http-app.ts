import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../src/app.module";
import { loadConfig } from "../../src/infrastructure/config/app-config";
import { configureHttpApp } from "../../src/interfaces/http/configure-app";
import { createTestDatabase, type TestDatabase } from "./test-database";

export interface HttpReply {
  status: number;
  body: unknown;
  headers: Headers;
}

export interface HttpTestApp {
  db: TestDatabase;
  request(method: string, path: string, init?: RequestOptions): Promise<HttpReply>;
  close(): Promise<void>;
}

export interface RequestOptions {
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

// Sobe o mesmo AppModule e configureHttpApp da produção, contra um banco descartável.
export async function startHttpApp(): Promise<HttpTestApp> {
  const db = await createTestDatabase();
  const base = loadConfig(process.env);
  const config = {
    ...base,
    database: { url: db.url },
    workers: { ...base.workers, sqsConsumerEnabled: false, backgroundWorkersEnabled: false },
  };
  const app: INestApplication = await NestFactory.create(AppModule.register(config), {
    logger: false,
  });
  configureHttpApp(app);
  await app.listen(0, "127.0.0.1");
  const baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  return {
    db,
    async request(method, path, init = {}) {
      const payload =
        init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json", ...init.headers },
        body: payload,
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text === "" ? null : JSON.parse(text),
        headers: response.headers,
      };
    },
    async close() {
      await app.close();
      await db.dispose();
    },
  };
}

export function field(body: unknown, name: string): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  return Object.entries(body).find(([key]) => key === name)?.[1];
}
