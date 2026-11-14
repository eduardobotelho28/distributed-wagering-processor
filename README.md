# Distributed Wagering Processor

Everything runs in Docker. No local Bun/Node install is required.

## Scripts

Run any script through the `app` service. `--rm` removes the one-off container afterwards.

```sh
docker compose run --rm app bun run <script>
```

| Script             | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `start`            | Starts the app once (no watch).                                      |
| `start:dev`        | Starts the app with hot reload. Default command of `docker compose up app`. |
| `lint`             | ESLint + Prettier check.                                             |
| `format`           | Prettier write.                                                      |
| `typecheck`        | `tsc --noEmit` with the strict config.                               |
| `test`             | Every test suite.                                                    |
| `test:unit`        | Unit tests (`test/unit`, `test/lint`). No Postgres/SQS needed.       |
| `test:integration` | Integration tests (`test/integration`) against real Postgres + LocalStack. |
| `test:concurrency` | Concurrency tests (`test/concurrency`) against real Postgres + LocalStack. |
| `migration:create` | Placeholder until MikroORM setup (T30).                              |
| `migration:up`     | Placeholder until MikroORM setup (T30).                              |
| `migration:down`   | Placeholder until MikroORM setup (T30).                              |

Examples:

```sh
docker compose run --rm app bun run lint
docker compose run --rm app bun run typecheck
docker compose run --rm app bun run test:unit
```

`docker compose run app` waits for `postgres` and `localstack` to be healthy, so integration and concurrency suites can reach them by service name.
