import { type DynamicModule, Module } from "@nestjs/common";
import type { AppConfig } from "./infrastructure/config/app-config";
import { AppConfigModule } from "./infrastructure/config/app-config.module";

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return { module: AppModule, imports: [AppConfigModule.forRoot(config)] };
  }
}
