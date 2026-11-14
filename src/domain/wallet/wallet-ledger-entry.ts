import { InvariantViolationError } from "../errors/invariant-violation.error";
import type { Money } from "../money/money";

export enum LedgerDirection {
  DEBIT = "DEBIT",
  CREDIT = "CREDIT",
}

export interface WalletLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  amount: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

// INVARIANT: lançamento é imutável; correções são novos lançamentos. O banco reforça com
// ausência de UPDATE/DELETE no repositório e o teste de invariante saldo == soma do ledger.
export class WalletLedgerEntry {
  private constructor(private readonly props: WalletLedgerEntryProps) {
    Object.freeze(this);
  }

  static create(props: WalletLedgerEntryProps): WalletLedgerEntry {
    if (!props.amount.isPositive()) {
      throw new InvariantViolationError("ledger amount must be positive");
    }
    const entry = new WalletLedgerEntry({ ...props, createdAt: new Date(props.createdAt) });
    if (!entry.isBalanced()) {
      throw new InvariantViolationError("balanceBefore ± amount must equal balanceAfter");
    }
    return entry;
  }

  // DECISION: rehydrate não revalida; dados vindos do banco já passaram por create.
  static rehydrate(props: WalletLedgerEntryProps): WalletLedgerEntry {
    return new WalletLedgerEntry({ ...props, createdAt: new Date(props.createdAt) });
  }

  isBalanced(): boolean {
    const expected =
      this.props.direction === LedgerDirection.DEBIT
        ? this.props.balanceBefore.subtract(this.props.amount)
        : this.props.balanceBefore.add(this.props.amount);
    return expected.equals(this.props.balanceAfter);
  }

  get id(): string {
    return this.props.id;
  }

  get walletId(): string {
    return this.props.walletId;
  }

  get transactionId(): string {
    return this.props.transactionId;
  }

  get direction(): LedgerDirection {
    return this.props.direction;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get balanceBefore(): Money {
    return this.props.balanceBefore;
  }

  get balanceAfter(): Money {
    return this.props.balanceAfter;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt);
  }
}
