import { type EntityManager, LockMode } from "@mikro-orm/postgresql";
import type { Wallet } from "../../../domain/wallet/wallet";
import { walletToDomain, walletToModel } from "../mappers/wallet.mapper";
import { WalletSchema } from "../models/wallet.model";

export class WalletNotPersistedError extends Error {
  constructor(walletId: string) {
    super(`wallet ${walletId} was not updated`);
    this.name = "WalletNotPersistedError";
  }
}

// DECISION: leituras ignoram o identity map e escritas são nativas. O agregado de domínio é a
// fonte do estado em memória; um modelo cacheado pelo ORM só abriria espaço para dado velho.
export class WalletRepository {
  constructor(private readonly em: EntityManager) {}

  // INVARIANT: precisa rodar dentro de uma transação; o MikroORM recusa lock fora dela.
  // DECISION: PESSIMISTIC_WRITE (SELECT ... FOR UPDATE) por carteira, nunca lock global.
  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    const model = await this.em.findOne(
      WalletSchema,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE, disableIdentityMap: true },
    );
    return model === null ? null : walletToDomain(model);
  }

  async findById(id: string): Promise<Wallet | null> {
    const model = await this.em.findOne(WalletSchema, { id }, { disableIdentityMap: true });
    return model === null ? null : walletToDomain(model);
  }

  async findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const model = await this.em.findOne(
      WalletSchema,
      { playerId, currency },
      { disableIdentityMap: true },
    );
    return model === null ? null : walletToDomain(model);
  }

  async insert(wallet: Wallet, now: Date): Promise<void> {
    await this.em.insert(WalletSchema, walletToModel(wallet, { createdAt: now, updatedAt: now }));
  }

  async saveBalance(wallet: Wallet, now: Date): Promise<void> {
    const affected = await this.em.nativeUpdate(
      WalletSchema,
      { id: wallet.id },
      { balance: wallet.balance.toJSON().amount, version: wallet.version, updatedAt: now },
    );
    if (affected !== 1) throw new WalletNotPersistedError(wallet.id);
  }
}
