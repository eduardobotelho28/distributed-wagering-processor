import { InvariantViolationError } from "../errors/invariant-violation.error";
import type { Money } from "../money/money";

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
