// optei string enum em vez de union de literais. Os valores são persistidos no banco
// e expostos na API, então precisam ser estáveis e explícitos; o enum dá um único ponto de verdade.
export enum FailureCode {
  /** Saldo insuficiente para o débito. Provedor: não reenviar igual; só após novo crédito na carteira. */
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  /** Estorno de crédito deixaria saldo negativo. Provedor: não reenviar; tratar manualmente. */
  REVERSAL_WOULD_OVERDRAW = "REVERSAL_WOULD_OVERDRAW",
  /** Transação de referência não existe. Provedor: reenviar depois que a referência for enviada. */
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
  /** Moeda difere da carteira ou da referência. Provedor: corrigir o payload. */
  CURRENCY_MISMATCH = "CURRENCY_MISMATCH",
  /** Carteira não existe. Provedor: corrigir o payload; não reenviar igual. */
  WALLET_NOT_FOUND = "WALLET_NOT_FOUND",
  /** REFUND/ROLLBACK sem referência. Provedor: corrigir o payload. */
  REFERENCE_REQUIRED = "REFERENCE_REQUIRED",
  /** Erro interno permanente; usado só no status FAILED. Provedor: desistir e acionar suporte. */
  INTERNAL_PERMANENT_ERROR = "INTERNAL_PERMANENT_ERROR",
}
