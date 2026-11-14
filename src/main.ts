import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadConfig } from "./infrastructure/config/app-config";

// DECISION: config is validated before Nest boots, so a missing var stops the process
// with a clear message instead of failing later inside a provider.
async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create(AppModule.register(config));
  app.enableShutdownHooks();

  await app.listen(config.port, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Bootstrap failed");
  process.exit(1);
});
