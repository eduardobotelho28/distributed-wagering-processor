import Decimal from "decimal.js";
import { CurrencyMismatchError } from "./currency-mismatch.error";
import { InvalidMoneyError } from "./invalid-money.error";

// DECISION: cópia própria do Decimal com 40 dígitos e expoentes em ±40. A precisão sobra para
// NUMERIC(19,2) e os limites impedem que toString() saia em notação científica ("1e+21").
const MoneyDecimal = Decimal.clone({ precision: 40, toExpPos: 40, toExpNeg: -40 });

// INVARIANT: só entra string decimal não negativa, com até 2 casas. NaN, Infinity, "1e3", "",
// "-1" e "1.234" são recusados antes de chegar ao Decimal (teste money-construction).
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const SCALE = 2;

export interface MoneyJSON {
  amount: string;
  currency: string;
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    readonly currency: string,
  ) {
    Object.freeze(this);
  }

  static from(input: { amount: unknown; currency: unknown }): Money {
    const currency = Money.parseCurrency(input.currency);
    if (typeof input.amount !== "string") throw new InvalidMoneyError("amount must be a string");

    if (!AMOUNT_PATTERN.test(input.amount)) {
      throw new InvalidMoneyError("amount must be a decimal string with up to 2 decimals");
    }

    return new Money(new MoneyDecimal(input.amount), currency);
  }

  static zero(currency: string): Money {
    return new Money(new MoneyDecimal(0), Money.parseCurrency(currency));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  // DECISION: subtract pode gerar Money negativo; o value object só garante a mesma moeda.
  // Quem decide se um saldo negativo é aceitável é a Wallet (a diferença da reconciliação, por
  // exemplo, pode ser negativa).
  // INVARIANT: saldo >= 0 é garantido por Wallet.debit e pelo CHECK (balance >= 0) no banco.
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  // DECISION: comparar moedas diferentes lança CurrencyMismatchError em vez de retornar false;
  // comparar BRL com USD é bug de quem chama, não uma resposta.
  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.equals(other.value);
  }

  assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency)
      throw new CurrencyMismatchError(this.currency, other.currency);
  }

  toJSON(): MoneyJSON {
    return { amount: this.formatAmount(), currency: this.currency };
  }

  toString(): string {
    return `${this.formatAmount()} ${this.currency}`;
  }

  private static parseCurrency(currency: unknown): string {
    if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError("currency must be a 3-letter uppercase code");
    }
    return currency;
  }

  // DECISION: escala de 2 casas montada à mão a partir de toString(), sem toFixed (proibido
  // pelo lint em src/ por arredondar via float). "10" vira "10.00", "0.5" vira "0.50".
  private formatAmount(): string {
    const [integer = "0", fraction = ""] = this.value.abs().toString().split(".");
    const sign = this.value.isNegative() ? "-" : "";
    return `${sign}${integer}.${fraction.padEnd(SCALE, "0")}`;
  }
}
