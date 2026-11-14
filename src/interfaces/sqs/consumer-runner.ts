import type { Logger } from "../../application/ports/logger";
import type { WagerMessageConsumer } from "./wager-message.consumer";

export interface RunnerOptions {
  maxMessages: number;
  // DECISION: long polling curto (2s). Limita quanto o shutdown espera um receive em curso;
  // custo é um pouco mais de chamadas vazias ao SQS com a fila ociosa.
  waitTimeSeconds: number;
  errorBackoffMs: number;
}

// Laço de polling com parada graciosa (T75): stop() para de buscar, espera a mensagem em
// andamento terminar e devolve as não iniciadas do lote; só então as conexões fecham.
export class ConsumerRunner {
  private stopping = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly consumer: WagerMessageConsumer,
    private readonly options: RunnerOptions,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.loop !== null) return;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.loop;
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.consumer.pollOnce(
          this.options.maxMessages,
          this.options.waitTimeSeconds,
          () => this.stopping,
        );
      } catch (error) {
        // RISK: falha do próprio SQS (receive/ack) só é logada e o laço espera; a mensagem
        // não confirmada volta pela visibilidade e o inbox impede efeito duplicado.
        this.logger.error("sqs consumer poll failed", {
          error: error instanceof Error ? error.name : "unknown",
        });
        await new Promise((resolve) => setTimeout(resolve, this.options.errorBackoffMs));
      }
    }
  }
}
