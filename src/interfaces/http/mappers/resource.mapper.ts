import type { ReconciliationReport } from "../../../application/reconcile-wallet/reconcile-wallet.use-case";
import type { FailureCode } from "../../../domain/errors/failure-code";
import type { MoneyJSON } from "../../../domain/money/money";
import type { TransactionKind } from "../../../domain/transaction/transaction-kind";
import type { TransactionStatus } from "../../../domain/transaction/transaction-status";
import type { WagerTransaction } from "../../../domain/transaction/wager-transaction";
import type { Wallet } from "../../../domain/wallet/wallet";
import type {
  LedgerDirection,
  WalletLedgerEntry,
} from "../../../domain/wallet/wallet-ledger-entry";

export interface WalletBody {
  id: string;
  playerId: string;
  balance: MoneyJSON;
  version: number;
}

export function walletToBody(wallet: Wallet): WalletBody {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
  };
}

export interface LedgerEntryBody {
  id: string;
  transactionId: string;
  direction: LedgerDirection;
  amount: MoneyJSON;
  balanceBefore: MoneyJSON;
  balanceAfter: MoneyJSON;
  createdAt: string;
}

export function ledgerEntryToBody(entry: WalletLedgerEntry): LedgerEntryBody {
  return {
    id: entry.id,
    transactionId: entry.transactionId,
    direction: entry.direction,
    amount: entry.amount.toJSON(),
    balanceBefore: entry.balanceBefore.toJSON(),
    balanceAfter: entry.balanceAfter.toJSON(),
    createdAt: entry.createdAt.toISOString(),
  };
}

export interface TransactionBody {
  id: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: TransactionKind;
  money: MoneyJSON;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  status: TransactionStatus;
  failureCode: FailureCode | null;
  processedAt: string | null;
  createdAt: string;
}

// DECISION: idempotencyKey e payloadHash ficam fora da resposta; são detalhes de controle
// interno e a key pode carregar convenções do provedor que não precisam ser reexpostas.
export function transactionToBody(transaction: WagerTransaction): TransactionBody {
  return {
    id: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    playerId: transaction.playerId,
    walletId: transaction.walletId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
    referenceExternalTransactionId: transaction.referenceExternalTransactionId,
    referenceTransactionId: transaction.referenceTransactionId,
    status: transaction.status,
    failureCode: transaction.failureCode,
    processedAt: transaction.processedAt?.toISOString() ?? null,
    createdAt: transaction.createdAt.toISOString(),
  };
}

export interface ReconciliationBody {
  walletId: string;
  storedBalance: MoneyJSON;
  calculatedBalance: MoneyJSON;
  difference: MoneyJSON;
  consistent: boolean;
  checkedEntries: number;
}

export function reconciliationToBody(report: ReconciliationReport): ReconciliationBody {
  return {
    walletId: report.walletId,
    storedBalance: report.storedBalance.toJSON(),
    calculatedBalance: report.calculatedBalance.toJSON(),
    difference: report.difference.toJSON(),
    consistent: report.consistent,
    checkedEntries: report.checkedEntries,
  };
}
