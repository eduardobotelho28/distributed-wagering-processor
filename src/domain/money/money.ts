import Decimal from "decimal.js";
import { InvalidMoneyError } from "./invalid-money.error";

// DECISION: isolated Decimal clone with exponent thresholds above NUMERIC(19,2) range,
// so toString() never switches to scientific notation and the global config stays untouched.
const MoneyDecimal = Decimal.clone({ precision: 40, toExpPos: 40, toExpNeg: -40 });

// INVARIANT: input amounts are non-negative, 1+ integer digits, at most 2 decimals.
// Anything else (NaN, Infinity, "1e3", "", "-1", "1.234") never reaches Decimal.
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

  toJSON(): MoneyJSON {
    return { amount: this.formatAmount(), currency: this.currency };
  }

  private static parseCurrency(currency: unknown): string {
    if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError("currency must be a 3-letter uppercase code");
    }
    return currency;
  }

  // DECISION: manual scale-2 padding instead of toFixed (banned by lint in src/).
  private formatAmount(): string {
    const [integer = "0", fraction = ""] = this.value.abs().toString().split(".");
    const sign = this.value.isNegative() ? "-" : "";
    return `${sign}${integer}.${fraction.padEnd(SCALE, "0")}`;
  }
}
