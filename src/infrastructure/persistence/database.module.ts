import { MikroORM } from "@mikro-orm/postgresql";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { buildMikroOrmOptions } from "./mikro-orm.config";

export class DatabaseConnectionError extends Error {
  constructor(reason: string) {
    super(`Database connection failed: ${reason}`);
    this.name = "DatabaseConnectionError";
  }
}

// DECISION: o boot falha cedo se o Postgres não responder, em vez de subir a API e quebrar na primeira requisição.
// O MikroORM v7 conecta de forma preguiçosa, então o connect() explícito força o pool antes do `select 1`.
@Injectable()
export class DatabaseConnectionCheck implements OnApplicationBootstrap {
  constructor(@Inject(MikroORM) private readonly orm: MikroORM) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.orm.connect();
    const result = await this.orm.checkConnection();
    if (!result.ok) {
      throw new DatabaseConnectionError(result.reason);
    }
  }
}

@Module({})
export class DatabaseModule {
  static forRoot(databaseUrl: string): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        MikroOrmModule.forRoot({
          ...buildMikroOrmOptions(databaseUrl),
          registerRequestContext: true,
        }),
      ],
      providers: [DatabaseConnectionCheck],
    };
  }
}
