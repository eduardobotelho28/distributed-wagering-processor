import type { Logger } from "../../application/ports/logger";

export interface IntervalWorkerOptions {
  name: string;
  intervalMs: number;
}

// DECISION: rodada -> espera -> rodada, em vez de setInterval. Uma rodada lenta nunca se
// sobrepõe à próxima no mesmo processo; entre processos, quem coordena é o SKIP LOCKED.
// INVARIANT: falha na rodada é logada e não para o laço; a próxima tenta de novo.
export class IntervalWorker {
  private stopping = false;
  private loop: Promise<void> | null = null;
  private wake: () => void = () => {};

  constructor(
    private readonly tick: () => Promise<unknown>,
    private readonly options: IntervalWorkerOptions,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.loop !== null) return;
    this.loop = this.run();
  }

  // Interrompe a espera na hora e aguarda a rodada em andamento terminar.
  async stop(): Promise<void> {
    this.stopping = true;
    this.wake();
    await this.loop;
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      await this.runTick();
      await this.sleep();
    }
  }

  private async runTick(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      this.logger.error("background worker tick failed", {
        worker: this.options.name,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  private sleep(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, this.options.intervalMs);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
