import type { ConsumeWagerMessageUseCase } from "../../application/consume-wager-message/consume-wager-message.use-case";
import type { ConsumeWagerMessageResult } from "../../application/consume-wager-message/consume-wager-message.use-case";
import type { MessageQueue, ReceivedMessage } from "../../application/ports/message-queue";
import { parseWagerMessage, type WagerMessage } from "./wager-message.parser";

// Tabela de classificação do consumidor (T73):
//
//   situação                                          classe        ação
//   processed / rejected / pendingReference           negócio       ack (após commit)
//   duplicate (inbox já tinha o messageId)            negócio       ack, sem efeito
//   exceção (banco fora, lock timeout, deadlock,      transitória   sem ack; visibilidade com
//     erro inesperado)                                              backoff; DLQ no limite (T74)
//   mensagem malformada / payload inválido / OPENING  permanente    DLQ
//   idempotencyConflict (mesma key, outro payload)    permanente    DLQ
//   failed (INTERNAL_PERMANENT_ERROR, já gravado)     permanente    DLQ
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

export interface ConsumerOptions {
  queueName: string;
  consumerName: string;
}

export class WagerMessageConsumer {
  constructor(
    private readonly queue: MessageQueue,
    private readonly consume: ConsumeWagerMessageUseCase,
    private readonly options: ConsumerOptions,
  ) {}

  async handle(received: ReceivedMessage): Promise<Disposition> {
    const parsed = parseWagerMessage(received.body);
    const disposition = parsed.ok
      ? await this.process(parsed.message)
      : deadLetter(parsed.code, parsed.reason);
    await this.apply(received, disposition);
    return disposition;
  }

  private async process(message: WagerMessage): Promise<Disposition> {
    try {
      const result = await this.consume.execute({
        consumerName: this.options.consumerName,
        messageId: message.messageId,
        submission: {
          ...message.request,
          // DECISION: a mensagem não traz correlationId próprio; o messageId correlaciona e
          // também é a causa dos eventos gerados.
          context: { correlationId: message.messageId, causationId: message.messageId },
        },
      });
      return classifyResult(result);
    } catch (error) {
      return { kind: "retry", error };
    }
  }

  // INVARIANT: ack só depois que consume.execute retornou, ou seja, depois do commit. Se o ack
  // falhar, a reentrega cai no inbox como duplicate e é confirmada sem efeito.
  private async apply(received: ReceivedMessage, disposition: Disposition): Promise<void> {
    const { queueName } = this.options;
    if (disposition.kind === "ack") {
      await this.queue.ack(queueName, received.receiptHandle);
      return;
    }
    if (disposition.kind === "retry") {
      const delay = retryDelaySeconds(received.receiveCount);
      await this.queue.changeVisibility(queueName, received.receiptHandle, delay);
    }
    // RISK: até a T74, permanente fica sem ack e o RedrivePolicy (maxReceiveCount=5) move a
    // mensagem para a DLQ, sem registrar o motivo.
  }
}
