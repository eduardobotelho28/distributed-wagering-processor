import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./interfaces/http/errors/global-exception.filter";
import { loadConfig } from "./infrastructure/config/app-config";

// aqui eu valido a configuração (.env) antes do Nest bootar, então uma variável ausente interrompe o processo com uma mensagem clara em vez de falhar mais tarde dentro de um provider.

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create(AppModule.register(config));
  app.enableShutdownHooks();
  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.listen(config.port, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Bootstrap failed");
  process.exit(1);
});
