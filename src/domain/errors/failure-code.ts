// DECISION: string enum em vez de união de literais. Os valores são persistidos, expostos na API
// e vão nos eventos, então precisam ser estáveis; o enum é o único ponto de verdade.
// INVARIANT: reenviar a MESMA idempotency key devolve sempre o mesmo resultado (replay). Quando a
// orientação abaixo diz "nova transação", é outro externalTransactionId e outra key.
export enum FailureCode {
  /** Saldo insuficiente para o débito. Provedor: nova transação só após um crédito na carteira. */
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  /** Estorno de crédito deixaria saldo negativo. Provedor: não reenviar; tratar manualmente. */
  REVERSAL_WOULD_OVERDRAW = "REVERSAL_WOULD_OVERDRAW",
  /** Referência não chegou dentro do limite (8 tentativas / 1h). Provedor: enviar a referência e uma nova reversão. */
  REFERENCE_NOT_FOUND = "REFERENCE_NOT_FOUND",
  /** Referência já foi estornada uma vez. Provedor: desistir; reenviar nunca terá sucesso. */
  REFERENCE_ALREADY_REVERSED = "REFERENCE_ALREADY_REVERSED",
  /** Provedor, jogador, carteira ou rodada diferem da referência. Provedor: corrigir o payload. */
  REFERENCE_MISMATCH = "REFERENCE_MISMATCH",
  /** Tipo da referência não pode ser estornado por este tipo. Provedor: corrigir o payload. */
  INVALID_REFERENCE_KIND = "INVALID_REFERENCE_KIND",
  /** Referência existe mas não está PROCESSED. Provedor: desistir; referência rejeitada não se estorna. */
  REFERENCE_NOT_PROCESSED = "REFERENCE_NOT_PROCESSED",
  /** Valor do estorno difere do valor da referência. Provedor: corrigir o payload. */
  AMOUNT_MISMATCH = "AMOUNT_MISMATCH",
  /** playerId do payload não é o dono da carteira. Provedor: corrigir o payload. */
  PLAYER_MISMATCH = "PLAYER_MISMATCH",
  /** Moeda difere da carteira ou da referência. Provedor: corrigir o payload. */
  CURRENCY_MISMATCH = "CURRENCY_MISMATCH",
  /** Carteira não existe. Provedor: corrigir o payload; não reenviar igual. */
  WALLET_NOT_FOUND = "WALLET_NOT_FOUND",
  /** REFUND/ROLLBACK sem referência. Provedor: corrigir o payload. */
  REFERENCE_REQUIRED = "REFERENCE_REQUIRED",
  /** Erro interno permanente; usado só no status FAILED. Provedor: desistir e acionar suporte. */
  INTERNAL_PERMANENT_ERROR = "INTERNAL_PERMANENT_ERROR",
}
