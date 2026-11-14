import { MikroORM } from "@mikro-orm/postgresql";
import { Module, type Provider } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { CreateWalletUseCase } from "../../application/create-wallet/create-wallet.use-case";
import type { Clock } from "../../application/ports/clock";
import type { HealthCheck } from "../../application/ports/health-check";
import type { IdGenerator } from "../../application/ports/id-generator";
import type { Logger } from "../../application/ports/logger";
import type { Metrics } from "../../application/ports/metrics";
import type { UnitOfWork } from "../../application/ports/unit-of-work";
import { GetLedgerUseCase } from "../../application/queries/get-ledger.use-case";
import { GetTransactionByIdUseCase } from "../../application/queries/get-transaction-by-id.use-case";
import { GetTransactionByProviderExternalIdUseCase } from "../../application/queries/get-transaction-by-provider-external-id.use-case";
import { GetWalletUseCase } from "../../application/queries/get-wallet.use-case";
import { ReconcileWalletUseCase } from "../../application/reconcile-wallet/reconcile-wallet.use-case";
import { SubmitWagerTransactionUseCase } from "../../application/submit-wager-transaction/submit-wager-transaction.use-case";
import { TrustAllProviderIdentity } from "../../infrastructure/auth/trust-all-provider-identity";
import type { AppConfig } from "../../infrastructure/config/app-config";
import { APP_CONFIG } from "../../infrastructure/config/app-config.module";
import { DatabaseHealthCheck } from "../../infrastructure/health/database-health-check";
import { SqsHealthCheck } from "../../infrastructure/health/sqs-health-check";
import { createSqsClient } from "../../infrastructure/messaging/sqs-client";
import { TransactionsController } from "./controllers/transactions.controller";
import { WalletsController } from "./controllers/wallets.controller";
import { AuthGuard } from "./auth/auth.guard";
import { HealthController } from "./health/health.controller";
import { MetricsController } from "./metrics/metrics.controller";
import { RequestContextInterceptor } from "./observability/request-context.interceptor";
import * as tokens from "../tokens";

const infrastructure: Provider[] = [
  {
    provide: tokens.HEALTH_CHECKS,
    useFactory: (orm: MikroORM, config: AppConfig): HealthCheck[] => [
      new DatabaseHealthCheck(orm),
      new SqsHealthCheck(createSqsClient(config.sqs), config.sqs.transactionsQueue),
    ],
    inject: [MikroORM, APP_CONFIG],
  },
  { provide: tokens.PROVIDER_IDENTITY, useValue: new TrustAllProviderIdentity() },
  { provide: APP_GUARD, useClass: AuthGuard },
  { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
];

const core = [tokens.UNIT_OF_WORK, tokens.CLOCK, tokens.ID_GENERATOR];

// DECISION: casos de uso são classes puras da application; o Nest só os instancia aqui.
const useCases: Provider[] = [
  {
    provide: tokens.CREATE_WALLET,
    useFactory: (u: UnitOfWork, c: Clock, i: IdGenerator) => new CreateWalletUseCase(u, c, i),
    inject: core,
  },
  {
    provide: tokens.SUBMIT_TRANSACTION,
    useFactory: (u: UnitOfWork, c: Clock, i: IdGenerator) =>
      new SubmitWagerTransactionUseCase(u, c, i),
    inject: core,
  },
  {
    provide: tokens.GET_WALLET,
    useFactory: (u: UnitOfWork) => new GetWalletUseCase(u),
    inject: [tokens.UNIT_OF_WORK],
  },
  {
    provide: tokens.GET_LEDGER,
    useFactory: (u: UnitOfWork) => new GetLedgerUseCase(u),
    inject: [tokens.UNIT_OF_WORK],
  },
  {
    provide: tokens.GET_TRANSACTION_BY_ID,
    useFactory: (u: UnitOfWork) => new GetTransactionByIdUseCase(u),
    inject: [tokens.UNIT_OF_WORK],
  },
  {
    provide: tokens.GET_TRANSACTION_BY_EXTERNAL_ID,
    useFactory: (u: UnitOfWork) => new GetTransactionByProviderExternalIdUseCase(u),
    inject: [tokens.UNIT_OF_WORK],
  },
  {
    provide: tokens.RECONCILE_WALLET,
    useFactory: (u: UnitOfWork, l: Logger, m: Metrics) => new ReconcileWalletUseCase(u, l, m),
    inject: [tokens.UNIT_OF_WORK, tokens.LOGGER, tokens.METRICS],
  },
];

@Module({
  controllers: [WalletsController, TransactionsController, HealthController, MetricsController],
  providers: [...infrastructure, ...useCases],
})
export class HttpModule {}
