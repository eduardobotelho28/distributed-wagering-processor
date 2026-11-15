import type { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import type { Metrics } from "../../application/ports/metrics";
import type { TransactionalRepositories, UnitOfWork } from "../../application/ports/unit-of-work";
import { DEFAULT_LOCK_TIMEOUT_MS } from "../config/app-config";
import { InboxRepository } from "./repositories/inbox.repository";
import { LedgerRepository } from "./repositories/ledger.repository";
import { OutboxRepository } from "./repositories/outbox.repository";
import { WagerTransactionRepository } from "./repositories/wager-transaction.repository";
import { type LockWaitObserver, WalletRepository } from "./repositories/wallet.repository";

export interface UnitOfWorkOptions {
  lockTimeoutMs?: number;
  metrics?: Metrics;
}

function repositoriesFor(
  em: EntityManager,
  onLockWait: LockWaitObserver,
): TransactionalRepositories {
  return {
    wallets: new WalletRepository(em, onLockWait),
    transactions: new WagerTransactionRepository(em),
    ledger: new LedgerRepository(em),
    inbox: new InboxRepository(em),
    outbox: new OutboxRepository(em),
  };
}

// DECISION: um fork do EntityManager por unidade de trabalho; requisições concorrentes nunca
// compartilham contexto. Os repositórios são criados sobre o EM da transação, então nenhum
// deles consegue escrever fora dela por engano.
export class MikroOrmUnitOfWork implements UnitOfWork {
  private readonly lockTimeoutMs: number;
  private readonly onLockWait: LockWaitObserver;

  constructor(
    private readonly orm: MikroORM,
    options: UnitOfWorkOptions = {},
  ) {
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    const metrics = options.metrics;
    this.onLockWait = (seconds) => metrics?.observe("wallet_lock_wait_seconds", seconds, {});
  }

  // DECISION: lock_timeout por transação (SET LOCAL). Sem ele, uma carteira presa (transação
  // travada, conexão pendurada) segura todas as requisições dela até esgotar o pool. Estourado,
  // o Postgres devolve 55P03: vira 503 retryable no HTTP e retry com backoff no SQS.
  // RISK: o valor precisa ser bem maior que a fila normal de uma carteira quente; 10s cobre
  // dezenas de movimentações serializadas (teste same-bet-50x com 3 instâncias).
  run<TResult>(
    work: (repositories: TransactionalRepositories) => Promise<TResult>,
  ): Promise<TResult> {
    return this.orm.em.fork().transactional(async (em) => {
      await em.execute(`set local lock_timeout = ${this.lockTimeoutMs}`);
      return work(repositoriesFor(em, this.onLockWait));
    });
  }
}
