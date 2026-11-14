export interface ReceivedMessage {
  // id do transporte (SQS MessageId); o messageId de negócio para o inbox vem do corpo.
  transportId: string;
  receiptHandle: string;
  body: string;
  // INVARIANT: vem do ApproximateReceiveCount do SQS; é a base do limite antes da DLQ (T74).
  receiveCount: number;
}

export interface ReceiveOptions {
  maxMessages: number;
  waitTimeSeconds: number;
}

export interface OutgoingMessage {
  body: string;
  // FIFO: ordem por grupo (walletId) e dedup do transporte. Ignorados em fila standard.
  groupId?: string;
  deduplicationId?: string;
}

// DECISION: filas identificadas por nome; o adapter resolve a URL. A aplicação não conhece
// SQS, só receber, confirmar, adiar e enviar.
export interface MessageQueue {
  receive(queue: string, options: ReceiveOptions): Promise<ReceivedMessage[]>;
  // INVARIANT: só depois do commit da transação que processou a mensagem (T73).
  ack(queue: string, receiptHandle: string): Promise<void>;
  changeVisibility(queue: string, receiptHandle: string, timeoutSeconds: number): Promise<void>;
  send(queue: string, message: OutgoingMessage): Promise<void>;
}
