import { type DynamicModule, Module } from "@nestjs/common";
import type { AppConfig } from "./infrastructure/config/app-config";
import { AppConfigModule } from "./infrastructure/config/app-config.module";
import { DatabaseModule } from "./infrastructure/persistence/database.module";
import { CoreModule } from "./interfaces/core.module";
import { HttpModule } from "./interfaces/http/http.module";
import { SqsConsumerModule } from "./interfaces/sqs/sqs-consumer.module";
import { WorkersModule } from "./interfaces/workers/workers.module";

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        DatabaseModule.forRoot(config.database.url),
        CoreModule,
        HttpModule,
        ...(config.workers.sqsConsumerEnabled ? [SqsConsumerModule] : []),
        ...(config.workers.backgroundWorkersEnabled ? [WorkersModule] : []),
      ],
    };
  }
}
