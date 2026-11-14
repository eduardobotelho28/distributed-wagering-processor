import { InvariantViolationError } from "../errors/invariant-violation.error";
import type { Money } from "../money/money";
import { InsufficientFundsError } from "./insufficient-funds.error";
import { LedgerDirection, WalletLedgerEntry } from "./wallet-ledger-entry";

export interface WalletProps {
  id: string;
  playerId: string;
  balance: Money;
  version: number;
}

export interface OpenWalletInput {
  id: string;
  playerId: string;
  initialBalance: Money;
}

const INITIAL_VERSION = 1;

// INVARIANT: balance >= 0. Também garantido pelo CHECK (balance >= 0) no banco.
export class Wallet {
  private constructor(private props: WalletProps) {}

  // DECISION: a moeda da carteira vem do saldo inicial; não há campo de moeda separado
  // que possa divergir do saldo.
  static open(input: OpenWalletInput): Wallet {
    if (input.initialBalance.isNegative()) {
      throw new InvariantViolationError("initial balance must not be negative");
    }
    return new Wallet({
      id: input.id,
      playerId: input.playerId,
      balance: input.initialBalance,
      version: INITIAL_VERSION,
    });
  }

  // DECISION: rehydrate não revalida; o estado vem do banco, já protegido pelo CHECK.
  static rehydrate(props: WalletProps): Wallet {
    return new Wallet({ ...props });
  }

  debit(amount: Money, transactionId: string, now: Date): WalletLedgerEntry {
    this.props.balance.assertSameCurrency(amount);
    if (this.props.balance.isLessThan(amount)) {
      throw new InsufficientFundsError(this.props.id);
    }
    return this.apply(LedgerDirection.DEBIT, amount, transactionId, now);
  }

  credit(amount: Money, transactionId: string, now: Date): WalletLedgerEntry {
    this.props.balance.assertSameCurrency(amount);
    return this.apply(LedgerDirection.CREDIT, amount, transactionId, now);
  }

  // DECISION: o id do lançamento é o id da transação. Cada transação move o saldo no máximo
  // uma vez, então a relação é 1:1 e evitamos gerar id aleatório dentro do domínio.
  // INVARIANT: WalletLedgerEntry.create rejeita valor <= 0, logo o saldo sempre muda e a
  // versão só incrementa quando há mudança real de saldo.
  private apply(
    direction: LedgerDirection,
    amount: Money,
    transactionId: string,
    now: Date,
  ): WalletLedgerEntry {
    const balanceBefore = this.props.balance;
    const balanceAfter =
      direction === LedgerDirection.DEBIT
        ? balanceBefore.subtract(amount)
        : balanceBefore.add(amount);
    const entry = WalletLedgerEntry.create({
      id: transactionId,
      walletId: this.props.id,
      transactionId,
      direction,
      amount,
      balanceBefore,
      balanceAfter,
      createdAt: now,
    });
    this.props = { ...this.props, balance: balanceAfter, version: this.props.version + 1 };
    return entry;
  }

  get id(): string {
    return this.props.id;
  }

  get playerId(): string {
    return this.props.playerId;
  }

  get balance(): Money {
    return this.props.balance;
  }

  get currency(): string {
    return this.props.balance.currency;
  }

  get version(): number {
    return this.props.version;
  }
}
