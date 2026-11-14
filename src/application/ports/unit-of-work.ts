// DECISION: o port recebe o conjunto de repositórios como parâmetro de tipo. Os ports de
// repositório chegam na T46; até lá a application não pode citar classes de infrastructure.
// INVARIANT: tudo que roda dentro de `run` compartilha uma única transação SQL; um erro
// lançado desfaz carteira, ledger, transação, inbox e outbox juntos.
export interface UnitOfWork<TRepositories> {
  run<TResult>(work: (repositories: TRepositories) => Promise<TResult>): Promise<TResult>;
}
