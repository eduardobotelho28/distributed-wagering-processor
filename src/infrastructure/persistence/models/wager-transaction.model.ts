import { defineEntity, type InferEntity, p } from "@mikro-orm/postgresql";
import { FailureCode } from "../../../domain/errors/failure-code";
import { TransactionKind } from "../../../domain/transaction/transaction-kind";
import { TransactionStatus } from "../../../domain/transaction/transaction-status";

export const WagerTransactionSchema = defineEntity({
  name: "WagerTransactionModel",
  tableName: "wager_transactions",
  properties: {
    id: p.uuid().primary(),
    idempotencyKey: p.string(),
    providerId: p.string(),
    externalTransactionId: p.string(),
    playerId: p.string(),
    walletId: p.uuid(),
    roundId: p.string(),
    gameId: p.string(),
    kind: p.enum(() => TransactionKind),
    amount: p.decimal("string").precision(19).scale(2),
    currency: p.string().columnType("char(3)"),
    referenceExternalTransactionId: p.string().nullable(),
    referenceTransactionId: p.uuid().nullable(),
    payloadHash: p.string().columnType("char(64)"),
    status: p.enum(() => TransactionStatus),
    resultingBalance: p.decimal("string").precision(19).scale(2).nullable(),
    failureCode: p.enum(() => FailureCode).nullable(),
    pendingAttempts: p.integer(),
    nextAttemptAt: p.datetime().nullable(),
    processedAt: p.datetime().nullable(),
    createdAt: p.datetime(),
  },
});

export type WagerTransactionModel = InferEntity<typeof WagerTransactionSchema>;
