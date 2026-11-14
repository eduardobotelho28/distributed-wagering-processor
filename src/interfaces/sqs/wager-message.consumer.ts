import type { AbandonWagerMessageUseCase } from "../../application/abandon-wager-message/abandon-wager-message.use-case";
import type {
  ConsumeWagerMessageInput,
  ConsumeWagerMessageResult,
  ConsumeWagerMessageUseCase,
} from "../../application/consume-wager-message/consume-wager-message.use-case";
import type { Clock } from "../../application/ports/clock";
import type { Logger } from "../../application/ports/logger";
import type { MessageQueue, ReceivedMessage } from "../../application/ports/message-queue";
import { parseWagerMessage, type WagerMessage } from "./wager-message.parser";

// Tabela de classificação do consumidor (T73/T74):
//
//   situação                                          classe        ação
//   processed / rejected / pendingReference           negócio       ack (após commit)
//   duplicate (inbox já tinha o messageId)            negócio       ack, sem efeito
//   exceção (banco fora, lock timeout, deadlock,      transitória   sem ack; visibilidade com
//     erro inesperado), abaixo do limite                            backoff exponencial
//   exceção no limite de recebimentos                 esgotada      FAILED gravado (se possível)
//                                                                   + DLQ com motivo + ack
//   mensagem malformada / payload inválido / OPENING  permanente    DLQ com motivo + ack
//   idempotencyConflict (mesma key, outro payload)    permanente    DLQ com motivo + ack
//   failed (INTERNAL_PERMANENT_ERROR, já gravado)     permanente    DLQ com motivo + ack
//
// DECISION: exceção inesperada é tratada como transitória. Repetir até o limite custa poucas
// tentativas; tratá-la como permanente na primeira vez mandaria para a DLQ algo que um
// restart do banco resolveria.
export type Disposition =
  | { kind: "ack" }
  | { kind: "retry"; error: unknown }
  | { kind: "deadLetter"; code: string; reason: string };

function deadLetter(code: string, reason: string): Disposition {
  return { kind: "deadLetter", code, reason };
}

export function classifyResult(result: ConsumeWagerMessageResult): Disposition {
  if (result.outcome === "duplicate") return { kind: "ack" };
  const submit = result.result;
  switch (submit.outcome) {
    case "processed":
    case "rejected":
    case "pendingReference":
      return { kind: "ack" };
    case "idempotencyConflict":
      return deadLetter("IDEMPOTENCY_CONFLICT", "key reused with another payload");
    case "invalidPayload":
      return deadLetter(submit.reason, "invalid transaction payload");
    case "failed":
      return deadLetter(submit.failureCode, "transaction failed permanently");
  }
}

// DECISION: backoff de visibilidade 5s, 10s, 20s... teto de 5min. Uma falha transitória de
// banco costuma durar segundos; dobrar evita martelar o banco enquanto ele volta.
const RETRY_BASE_SECONDS = 5;
const RETRY_MAX_SECONDS = 300;

export function retryDelaySeconds(receiveCount: number): number {
  return Math.min(RETRY_BASE_SECONDS * 2 ** Math.max(receiveCount - 1, 0), RETRY_MAX_SECONDS);
}

export interface DeadLetterEnvelope {
  code: string;
  reason: string;
  messageId: string | null;
  receiveCount: number;
  failedAt: string;
  originalBody: string;
}

export interface ConsumerOptions {
  queueName: string;
  deadLetterQueueName: string;
  consumerName: string;
  // INVARIANT: <= maxReceiveCount do RedrivePolicy da fila (5, docker/localstack); o consumidor
  // move para a DLQ com motivo antes que o SQS mova sem motivo.
  maxReceives: number;
}

export interface ConsumerDependencies {
  queue: MessageQueue;
  consume: ConsumeWagerMessageUseCase;
  abandon: AbandonWagerMessageUseCase;
  clock: Clock;
  logger: Logger;
}

export class WagerMessageConsumer {
  constructor(
    private readonly deps: ConsumerDependencies,
    private readonly options: ConsumerOptions,
  ) {}

  async pollOnce(maxMessages: number, waitTimeSeconds: number): Promise<number> {
    const messages = await this.deps.queue.receive(this.options.queueName, {
      maxMessages,
      waitTimeSeconds,
    });
    for (const message of messages) await this.handle(message);
    return messages.length;
  }

  async handle(received: ReceivedMessage): Promise<Disposition> {
    const parsed = parseWagerMessage(received.body);
    const disposition = parsed.ok
      ? await this.process(received, parsed.message)
      : deadLetter(parsed.code, parsed.reason);
    await this.apply(received, disposition, parsed.ok ? parsed.message : null);
    return disposition;
  }

  private async process(received: ReceivedMessage, message: WagerMessage): Promise<Disposition> {
    const input = this.inputFor(message);
    try {
      return classifyResult(await this.deps.consume.execute(input));
    } catch (error) {
      if (received.receiveCount < this.options.maxReceives) return { kind: "retry", error };
      await this.recordAbandoned(input);
      return deadLetter("RETRIES_EXHAUSTED", "transient failure persisted until the retry limit");
    }
  }

  private inputFor(message: WagerMessage): ConsumeWagerMessageInput {
    return {
      consumerName: this.options.consumerName,
      messageId: message.messageId,
      submission: {
        ...message.request,
        // DECISION: a mensagem não traz correlationId próprio; o messageId correlaciona e
        // também é a causa dos eventos gerados.
        context: { correlationId: message.messageId, causationId: message.messageId },
      },
    };
  }

  // RISK: se o banco ainda estiver fora, o FAILED não é gravado; a mensagem vai para a DLQ
  // mesmo assim (com motivo) e o erro é logado. Reprocessar da DLQ grava depois.
  private async recordAbandoned(input: ConsumeWagerMessageInput): Promise<void> {
    try {
      await this.deps.abandon.execute(input);
    } catch (error) {
      this.deps.logger.error("could not record abandoned wager message", {
        messageId: input.messageId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  // INVARIANT: ack só depois que consume.execute retornou, ou seja, depois do commit. Se o ack
  // falhar, a reentrega cai no inbox como duplicate e é confirmada sem efeito.
  private async apply(
    received: ReceivedMessage,
    disposition: Disposition,
    message: WagerMessage | null,
  ): Promise<void> {
    const { queueName } = this.options;
    if (disposition.kind === "retry") {
      const delay = retryDelaySeconds(received.receiveCount);
      await this.deps.queue.changeVisibility(queueName, received.receiptHandle, delay);
      return;
    }
    if (disposition.kind === "deadLetter")
      await this.sendToDeadLetter(received, disposition, message);
    await this.deps.queue.ack(queueName, received.receiptHandle);
  }

  // DECISION: envia para a DLQ ANTES do ack do original. Se o processo morrer entre os dois,
  // a mensagem volta e é reenviada à DLQ; o MessageDeduplicationId (id de transporte) faz a
  // FIFO descartar a cópia dentro da janela de dedup.
  private async sendToDeadLetter(
    received: ReceivedMessage,
    disposition: { code: string; reason: string },
    message: WagerMessage | null,
  ): Promise<void> {
    const envelope: DeadLetterEnvelope = {
      code: disposition.code,
      reason: disposition.reason,
      messageId: message?.messageId ?? null,
      receiveCount: received.receiveCount,
      failedAt: this.deps.clock.now().toISOString(),
      originalBody: received.body,
    };
    await this.deps.queue.send(this.options.deadLetterQueueName, {
      body: JSON.stringify(envelope),
      groupId: message?.request.walletId ?? received.transportId,
      deduplicationId: received.transportId,
    });
    this.deps.logger.error("wager message moved to dead-letter queue", {
      messageId: envelope.messageId ?? received.transportId,
      code: disposition.code,
      receiveCount: received.receiveCount,
    });
  }
}
