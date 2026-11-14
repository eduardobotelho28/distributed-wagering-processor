import { GetQueueUrlCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { HealthCheck, HealthStatus } from "../../application/ports/health-check";
import { withTimeout } from "./with-timeout";

export class SqsHealthCheck implements HealthCheck {
  readonly name = "sqs";

  constructor(
    private readonly client: SQSClient,
    private readonly queueName: string,
  ) {}

  // DECISION: GetQueueUrl na fila consumida a cada checagem, sem cache; prova que o SQS
  // responde E que a fila existe, não só que o endpoint aceita HTTP.
  check(): Promise<HealthStatus> {
    return withTimeout(async () => {
      const output = await this.client.send(new GetQueueUrlCommand({ QueueName: this.queueName }));
      return output.QueueUrl !== undefined;
    });
  }
}
