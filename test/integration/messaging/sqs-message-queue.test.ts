import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import { loadConfig } from "../../../src/infrastructure/config/app-config";
import { createSqsClient } from "../../../src/infrastructure/messaging/sqs-client";
import { SqsMessageQueue } from "../../../src/infrastructure/messaging/sqs-message-queue";

// DECISION: fila FIFO própria por execução; não disputa mensagens com a fila real nem com
// outras suítes rodando em paralelo.
const queueName = `test-${crypto.randomUUID()}.fifo`;
const client = createSqsClient(loadConfig(process.env).sqs);
const queue = new SqsMessageQueue(client);

beforeAll(async () => {
  await client.send(
    new CreateQueueCommand({
      QueueName: queueName,
      Attributes: { FifoQueue: "true", VisibilityTimeout: "30" },
    }),
  );
});

afterAll(async () => {
  await client.send(new DeleteQueueCommand({ QueueUrl: await queue.urlOf(queueName) }));
});

async function sendOne(body: string, groupId: string): Promise<void> {
  await queue.send(queueName, { body, groupId, deduplicationId: crypto.randomUUID() });
}

describe("SqsMessageQueue against LocalStack", () => {
  test("sends and receives on the FIFO queue, then acks", async () => {
    await sendOne('{"hello":"world"}', "wallet-1");

    const [message] = await queue.receive(queueName, { maxMessages: 10, waitTimeSeconds: 2 });

    expect(message?.body).toBe('{"hello":"world"}');
    expect(message?.receiveCount).toBe(1);
    if (message === undefined) throw new Error("expected a message");
    await queue.ack(queueName, message.receiptHandle);
    expect(await queue.receive(queueName, { maxMessages: 10, waitTimeSeconds: 1 })).toEqual([]);
  });

  test("keeps FIFO order inside a message group", async () => {
    for (const body of ["first", "second", "third"]) await sendOne(body, "wallet-order");

    const messages = await queue.receive(queueName, { maxMessages: 10, waitTimeSeconds: 2 });

    expect(messages.map((message) => message.body)).toEqual(["first", "second", "third"]);
    for (const message of messages) await queue.ack(queueName, message.receiptHandle);
  });

  test("redelivers after changing visibility to zero and counts the receive", async () => {
    await sendOne("retry-me", "wallet-retry");
    const [first] = await queue.receive(queueName, { maxMessages: 1, waitTimeSeconds: 2 });
    if (first === undefined) throw new Error("expected a message");

    await queue.changeVisibility(queueName, first.receiptHandle, 0);
    const [again] = await queue.receive(queueName, { maxMessages: 1, waitTimeSeconds: 2 });

    expect(again?.transportId).toBe(first.transportId);
    expect(again?.receiveCount).toBe(2);
    if (again !== undefined) await queue.ack(queueName, again.receiptHandle);
  });
});
