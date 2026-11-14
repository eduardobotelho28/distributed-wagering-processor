import { Money } from "../../domain/money/money";

export interface MoneyColumns {
  amount: string;
  currency: string;
}

// DECISION: mapper explícito em vez de custom Type do MikroORM: o Money ocupa duas colunas
// (amount + currency) e um Type mapeia só uma. Os modelos da T38 chamam estas funções.
// INVARIANT: o driver pg devolve numeric como string; Money.from rejeita qualquer não-string,
// então um número nunca entra no domínio por aqui.
export function moneyToColumns(money: Money): MoneyColumns {
  return money.toJSON();
}

export function moneyFromColumns(columns: { amount: unknown; currency: unknown }): Money {
  return Money.from(columns);
}
