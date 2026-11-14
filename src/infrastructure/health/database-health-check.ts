import type { MikroORM } from "@mikro-orm/postgresql";
import type { HealthCheck, HealthStatus } from "../../application/ports/health-check";
import { withTimeout } from "./with-timeout";

export class DatabaseHealthCheck implements HealthCheck {
  readonly name = "database";

  constructor(private readonly orm: MikroORM) {}

  // DECISION: `select 1` real em vez de olhar o estado do pool; o pool pode ter conexões
  // abertas e mesmo assim o banco recusar novas (restart, max_connections).
  check(): Promise<HealthStatus> {
    return withTimeout(async () => {
      await this.orm.em.getConnection().execute("select 1");
      return true;
    });
  }
}
