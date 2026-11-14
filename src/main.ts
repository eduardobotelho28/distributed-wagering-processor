import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

const DEFAULT_PORT = "3000";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // DECISION: port stays a string; Node's listen accepts it, so no numeric parsing here.
  // Typed, validated config arrives in T10.
  await app.listen(process.env.APP_PORT ?? DEFAULT_PORT, "0.0.0.0");
}

void bootstrap();
