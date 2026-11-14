import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  type Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import type {
  MessageQueue,
  OutgoingMessage,
  ReceivedMessage,
  ReceiveOptions,
} from "../../application/ports/message-queue";

const RECEIVE_COUNT = /^\d+$/;

export class InvalidQueueMessageError extends Error {
  constructor(reason: string) {
    super(`SQS returned an unusable message: ${reason}`);
    this.name = "InvalidQueueMessageError";
  }
}

function toReceived(message: Message): ReceivedMessage {
  const { MessageId, ReceiptHandle, Body } = message;
  if (MessageId === undefined || ReceiptHandle === undefined || Body === undefined) {
    throw new InvalidQueueMessageError("missing id, receipt handle or body");
  }
  const count = message.Attributes?.ApproximateReceiveCount ?? "1";
  return {
    transportId: MessageId,
    receiptHandle: ReceiptHandle,
    body: Body,
    receiveCount: RECEIVE_COUNT.test(count) ? Number.parseInt(count, 10) : 1,
  };
}

export class SqsMessageQueue implements MessageQueue {
  // DECISION: cache de nome -> URL só para não repetir GetQueueUrl a cada chamada; a URL de
  // uma fila não muda enquanto ela existir. Não participa de dedup nem de idempotência.
  private readonly urls = new Map<string, Promise<string>>();

  constructor(private readonly client: SQSClient) {}

  async receive(queue: string, options: ReceiveOptions): Promise<ReceivedMessage[]> {
    const output = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: await this.urlOf(queue),
        MaxNumberOfMessages: options.maxMessages,
        WaitTimeSeconds: options.waitTimeSeconds,
        MessageSystemAttributeNames: ["ApproximateReceiveCount"],
      }),
    );
    return (output.Messages ?? []).map(toReceived);
  }

  async ack(queue: string, receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: await this.urlOf(queue), ReceiptHandle: receiptHandle }),
    );
  }

  async changeVisibility(
    queue: string,
    receiptHandle: string,
    timeoutSeconds: number,
  ): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: await this.urlOf(queue),
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: timeoutSeconds,
      }),
    );
  }

  async send(queue: string, message: OutgoingMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: await this.urlOf(queue),
        MessageBody: message.body,
        MessageGroupId: message.groupId,
        MessageDeduplicationId: message.deduplicationId,
      }),
    );
  }

  urlOf(queue: string): Promise<string> {
    const cached = this.urls.get(queue);
    if (cached !== undefined) return cached;
    const url = this.resolveUrl(queue);
    this.urls.set(queue, url);
    url.catch(() => this.urls.delete(queue));
    return url;
  }

  private async resolveUrl(queue: string): Promise<string> {
    const output = await this.client.send(new GetQueueUrlCommand({ QueueName: queue }));
    if (output.QueueUrl === undefined) throw new InvalidQueueMessageError(`no url for ${queue}`);
    return output.QueueUrl;
  }
}
