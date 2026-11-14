# AGENTS.md

Project: Distributed Wagering Processor (Jungle Gaming challenge).
Stack: Bun 1.x, TypeScript strict, NestJS, PostgreSQL, MikroORM, AWS SQS (LocalStack), Docker Compose.
Everything runs in Docker. Never require local installs.

## Workflow protocol

1. Read TASKS.md. Do ONLY the first unchecked task. Never start the next one.
2. Branch: `feat/tNN-short-name`. Small commits, Conventional Commits (`feat:`, `test:`, `fix:`, `docs:`, `chore:`).
3. Before marking done, run: `bun run lint && bun run typecheck && bun test`. All must pass.
4. Mark the task `[x]` in TASKS.md in the last commit, then STOP and report what changed.
5. If the task is ambiguous or conflicts with these rules, stop and ask. Do not guess.

## Hard rules (never break)

- NEVER use `number`, `float`, `double`, `parseFloat`, `Number()` or `toFixed` for money. Money is `Money` (Decimal) in code, `NUMERIC(19,2)` in the DB, decimal string in JSON.
- NEVER use in-memory cache/Map/Set as idempotency or dedup guarantee. The DB is the source of truth.
- NEVER read → compute → update a balance without a lock. Wallet row is loaded with `PESSIMISTIC_WRITE` inside the transaction.
- NEVER use a global lock. The concurrency unit is the wallet row.
- NEVER update or delete ledger rows. Corrections are new entries.
- NEVER publish an event before the SQL commit. Events are written to the outbox in the same transaction.
- NEVER ack an SQS message before commit.
- NEVER allow negative balance. Enforce with domain check AND `CHECK (balance >= 0)`.
- NEVER let `OPENING` come from HTTP or SQS.
- NEVER mock PostgreSQL or SQS in integration/concurrency tests.
- NEVER add Prisma, extra ORMs, or new dependencies without asking.
- NEVER log full financial payloads or sensitive data.

## Architecture

```
src/
  domain/          pure TS: entities, value objects, domain errors. No Nest, no ORM, no decorators.
  application/     use cases + ports (interfaces). Orchestrates; no SQL here.
  infrastructure/  MikroORM repos, SQS client, outbox publisher, schedulers.
  interfaces/      HTTP controllers, SQS consumer, health. Thin: parse → call use case → map result.
```

- Dependencies point inward: interfaces → application → domain. Domain imports nothing from outside.
- One use case per file, one public `execute()`.
- HTTP and SQS call the SAME use case.
- Aggregates: private constructor + static factories (`create`, `rehydrate`). `rehydrate` never revalidates transitions.
- State changes through explicit methods only. No public setters.
- Domain errors are classes with a stable `FailureCode`. Business rejection is a result, not an exception leaking to the client.

## Clean code

- Flat and readable. No recursion where a loop works. No abstraction without 2+ real uses.
- Functions do one thing, ~20 lines max. Early returns instead of nested ifs.
- No generic `utils.ts`, `helpers.ts`, `manager`, `base` classes.
- No `any`. No `as` casts to silence the compiler. No non-null `!`.
- No comments that restate the code. Comments explain WHY (see below).
- Names: English.
- No dead code, no commented-out code, no TODOs without a task id.

Bad:

```ts
const total = balance + parseFloat(amount); // float money
await wallet.save(); // no lock, lost update
```

Good:

```ts
const wallet = await this.wallets.findByIdForUpdate(walletId); // PESSIMISTIC_WRITE
const entry = wallet.debit(money, transaction.id, now);
```

## Comments policy

Add short comments ONLY at decision points, with a tag:

- `// DECISION:` what was chosen and why over the alternative
- `// INVARIANT:` what must always hold and where else it is enforced (DB constraint, test)
- `// RISK:` known limitation or trade-off

Example:

```ts
// DECISION: pessimistic lock instead of optimistic retry. A hot wallet under
// contention would burn retries; a row lock serializes cleanly and is easy to reason about.
// INVARIANT: balance >= 0 is also enforced by CHECK constraint (migration T19).
```

## Testing

- Unit: domain + use cases with fakes. Deterministic, no clock/random without injection.
- Integration: real PostgreSQL + LocalStack in containers.
- Concurrency: real parallelism (`Promise.all` and multiple processes), never sequential fakes.
- Final invariant in every integration/concurrency test: `wallet.balance == sum of ledger`.
- Test names describe behavior: `rejects the second bet when balance is insufficient`.

## Definition of done

Lint, typecheck, tests green; migration has `down`; no rule above violated; TASKS.md updated; change is small enough to review in 5 minutes.