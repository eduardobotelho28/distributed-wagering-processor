import Decimal from "decimal.js";
import { CurrencyMismatchError } from "./currency-mismatch.error";
import { InvalidMoneyError } from "./invalid-money.error";

// Aqui eu crio uma cópia da classe Decimal com precisão de 40 dígitos e limites de expoente para evitar notação científica em valores monetários. Isso garante que os valores sejam representados de forma legível e consistente, especialmente quando lidamos com grandes quantias de dinheiro.
const MoneyDecimal = Decimal.clone({ precision: 40, toExpPos: 40, toExpNeg: -40 });

// Regras: Não negativo, pelo menos 1 dígito inteiro, no máximo 2 casas decimais. Qualquer outra coisa (NaN, Infinity, "1e3", "", "-1", "1.234") nunca chega ao Decimal.
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

  // decidi aqui que o subtract pode gerar Money negativo. Quem decide se saldo negativo é permitido é a Wallet,
  // não o value object, segundo o princípio de responsabilidade única. O value object só garante que a operação seja válida, ou seja, que as moedas sejam iguais.
  // balance >= 0 é garantido pela Wallet e pelo CHECK no banco.
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

  // Aqui eu decidi que comparar moedas diferentes lança erro em vez de retornar false;
  // comparar BRL com USD é bug de quem chama.
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

  // aqui eu decido por setar manualmente a escala para 2 casas decimais em vez de usar o método toFixed, que é proibido pelo lint no diretório src/. Isso garante que os valores monetários sejam sempre representados com duas casas decimais, mesmo que o valor original tenha menos casas decimais.
  private formatAmount(): string {
    const [integer = "0", fraction = ""] = this.value.abs().toString().split(".");
    const sign = this.value.isNegative() ? "-" : "";
    return `${sign}${integer}.${fraction.padEnd(SCALE, "0")}`;
  }
}
