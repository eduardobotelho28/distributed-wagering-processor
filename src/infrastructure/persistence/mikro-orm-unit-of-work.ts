import type { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import type { UnitOfWork } from "../../application/ports/unit-of-work";
import { InboxRepository } from "./repositories/inbox.repository";
import { LedgerRepository } from "./repositories/ledger.repository";
import { OutboxRepository } from "./repositories/outbox.repository";
import { WagerTransactionRepository } from "./repositories/wager-transaction.repository";
import { WalletRepository } from "./repositories/wallet.repository";

export interface PersistenceRepositories {
  wallets: WalletRepository;
  transactions: WagerTransactionRepository;
  ledger: LedgerRepository;
  inbox: InboxRepository;
  outbox: OutboxRepository;
}

function repositoriesFor(em: EntityManager): PersistenceRepositories {
  return {
    wallets: new WalletRepository(em),
    transactions: new WagerTransactionRepository(em),
    ledger: new LedgerRepository(em),
    inbox: new InboxRepository(em),
    outbox: new OutboxRepository(em),
  };
}

// DECISION: um fork do EntityManager por unidade de trabalho; requisições concorrentes nunca
// compartilham contexto. Os repositórios são criados sobre o EM da transação, então nenhum
// deles consegue escrever fora dela por engano.
export class MikroOrmUnitOfWork implements UnitOfWork<PersistenceRepositories> {
  constructor(private readonly orm: MikroORM) {}

  run<TResult>(
    work: (repositories: PersistenceRepositories) => Promise<TResult>,
  ): Promise<TResult> {
    return this.orm.em.fork().transactional((em) => work(repositoriesFor(em)));
  }
}
