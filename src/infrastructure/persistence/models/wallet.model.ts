import { defineEntity, type InferEntity, p } from "@mikro-orm/postgresql";

// DECISION: defineEntity em vez de classes decoradas; o modelo é só o formato da linha e
// fica isolado em infrastructure. O domínio nunca vê este tipo; a conversão é feita pelo mapper.
// INVARIANT: decimal em modo "string"; o valor nunca vira number no caminho banco -> Money.
export const WalletSchema = defineEntity({
  name: "WalletModel",
  tableName: "wallets",
  properties: {
    id: p.uuid().primary(),
    playerId: p.string(),
    currency: p.string().columnType("char(3)"),
    balance: p.decimal("string").precision(19).scale(2),
    version: p.integer(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export type WalletModel = InferEntity<typeof WalletSchema>;
