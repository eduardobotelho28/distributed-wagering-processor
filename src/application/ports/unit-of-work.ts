import type {
  InboxRepositoryPort,
  LedgerRepositoryPort,
  OutboxRepositoryPort,
  WagerTransactionRepositoryPort,
  WalletRepositoryPort,
} from "./repositories";

export interface TransactionalRepositories {
  wallets: WalletRepositoryPort;
  transactions: WagerTransactionRepositoryPort;
  ledger: LedgerRepositoryPort;
  inbox: InboxRepositoryPort;
  outbox: OutboxRepositoryPort;
}

// INVARIANT: tudo que roda dentro de `run` compartilha uma única transação SQL; um erro
// lançado desfaz carteira, ledger, transação, inbox e outbox juntos.
export interface UnitOfWork {
  run<TResult>(
    work: (repositories: TransactionalRepositories) => Promise<TResult>,
  ): Promise<TResult>;
}
