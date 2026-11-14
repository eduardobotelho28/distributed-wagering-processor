// DECISION: erro de port, não de domínio; só o banco sabe que (playerId, currency) já existe
// sob concorrência. O repositório traduz a violação do UNIQUE para este erro.
export class WalletAlreadyExistsError extends Error {
  constructor(playerId: string, currency: string) {
    super(`wallet already exists for player ${playerId} in ${currency}`);
    this.name = "WalletAlreadyExistsError";
  }
}
