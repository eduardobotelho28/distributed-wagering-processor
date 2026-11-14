# TASKS

Source of truth for the work. Read `AGENTS.md` first.

## Protocol (for the AI agent)

1. Do ONLY the first unchecked task (`- [ ]`). Never start the next one.
2. Branch: `feat/tNN-short-name` from an up-to-date `main`.
3. 1 to 3 small commits, Conventional Commits.
4. Run `bun run lint && bun run typecheck && bun test` (inside Docker). Everything must pass.
5. Check the box, add the commit hash(es) next to the task, commit `docs: mark tNN done`.
6. Report in 5 lines max: what changed, which decisions you made, anything doubtful. Then STOP.
7. If a task is ambiguous or conflicts with `AGENTS.md`, stop and ask.

Legend: `[HUMAN]` = Eduardo does it by hand. `[CORE]` = high-risk task, use plan mode and review the diff carefully.

## Fixed decisions (do not re-discuss, document them in ARCHITECTURE.md)

- Concurrency: pessimistic lock (`SELECT ... FOR UPDATE`, MikroORM `LockMode.PESSIMISTIC_WRITE`) on the wallet row. Lock the wallet BEFORE the idempotency lookup.
- Money: `decimal.js` in domain; `NUMERIC(19,2)` + `currency CHAR(3)` in DB; decimal string in JSON.
- Outbox and PENDING_REFERENCE workers: `FOR UPDATE SKIP LOCKED`.
- Idempotency: UNIQUE `idempotency_key` + UNIQUE `(provider_id, external_transaction_id)` in DB; `payload_hash` = sha256 of canonical JSON (sorted keys) of business fields only.
- Replay returns the original result: the transaction row stores `resulting_balance`.
- Reversal interpretation (document it): a reference can be reversed at most ONCE in total, by any REFUND/ROLLBACK, enforced by a partial UNIQUE index on `reference_transaction_id` where `status = 'PROCESSED'`.
- HTTP status: 400 invalid payload, 409 idempotency conflict, 422 business rejection, 202 accepted/pending reference, 503 transient infra failure (with `Retry-After`). Same mapping on every endpoint. Replays of a REJECTED transaction return 422 again.
- Auth: not implemented. No-op `AuthGuard` + `ProviderIdentityPort` + decision documented.

---

## Phase 0: Repo and environment

- [ x ] **T00 [HUMAN] Create the repository**
  Create GitHub repo, `.gitignore` (node, bun, env, dist, coverage), `.editorconfig`, stub `README.md`. Protect `main` (PR required, even if solo).
  Done when: repo cloned locally, first commit on `main`.

- [ x ] **T01 [HUMAN] Add agent files**
  Add `AGENTS.md`, `TASKS.md`, `CLAUDE.md` (single line: `@AGENTS.md`) and `.claude/commands/next.md`.
  Done when: committed on `main`.

- [x] **T02 Dev Dockerfile** (d7ae5bf)
  `Dockerfile` based on `oven/bun:1`, workdir `/app`, install deps, `.dockerignore`.
  Done when: `docker build .` succeeds.

- [x] **T03 Compose: PostgreSQL** (ef297ef)
  `docker-compose.yml` with `postgres:16`, named volume, healthcheck (`pg_isready`), env from `.env`.
  Done when: `docker compose up -d postgres` is healthy.

- [x] **T04 Compose: LocalStack (SQS)** (2f593fb)
  Add `localstack/localstack` with `SERVICES=sqs` and a healthcheck.
  Done when: `docker compose up -d localstack` is healthy.

- [x] **T05 Queue bootstrap script** (fc969d4)
  Init script (mounted in LocalStack `ready.d`) creating `wager-transactions.fifo`, `wager-transactions-dlq.fifo` (redrive policy, `maxReceiveCount` = 5) and a standard `wager-events` queue for outbox publishing.
  Done when: `awslocal sqs list-queues` shows all three after `compose up`.

- [ ] **T06 NestJS scaffold under Bun**
  Minimal Nest app in `src/`, `app` service in compose with hot reload (`bun --watch`), `.env.example`.
  Done when: `docker compose up app` serves the Nest app; no default hello-world controller left.

- [ ] **T07 Strict TypeScript**
  `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
  Done when: `bun run typecheck` passes on the scaffold.

- [ ] **T08 Lint and format**
  ESLint (typescript-eslint) + Prettier. Rules: `no-explicit-any`, `no-non-null-assertion`, `no-restricted-globals`/syntax for `parseFloat`, `Number(`, `.toFixed(` inside `src/**`.
  Done when: `bun run lint` passes; adding `parseFloat("1")` makes it fail.

- [ ] **T09 Scripts**
  `package.json` scripts: `lint`, `typecheck`, `test`, `test:unit`, `test:integration`, `test:concurrency`, `migration:up`, `migration:down`, `migration:create`, `start`, `start:dev`. Document how to run each through `docker compose run`.
  Done when: all scripts exist (placeholders allowed for ones that depend on later tasks).

- [ ] **T10 Config module**
  Typed, validated env config (DB url, SQS endpoint/queue names, worker intervals, limits). Fail fast on missing vars.
  Done when: app refuses to boot with a missing required var; unit test covers it.

- [ ] **T11 CI**
  GitHub Actions: install, lint, typecheck, unit tests.
  Done when: workflow green on a PR.

- [ ] **T12 Folder skeleton and boundaries**
  Create `src/domain`, `src/application`, `src/infrastructure`, `src/interfaces`. ESLint rule: `domain` cannot import `@nestjs/*`, `@mikro-orm/*`, or anything outside `domain`; `application` cannot import `infrastructure` or `interfaces`.
  Done when: a deliberate bad import fails lint.

---

## Phase 1: Domain (pure TypeScript, no Nest, no ORM)

- [ ] **T13 [CORE] Money: construction and parsing**
  `Money.from({amount, currency})`, `Money.zero(currency)`. Accept only decimal strings with exactly 1+ integer digits and up to 2 decimals; normalize to scale 2. Reject: NaN, Infinity, scientific notation, empty, more than 2 decimals, negative (in input contracts), non-string.
  Done when: private constructor, immutable, `toJSON()` returns `{amount: "25.00", currency}`.

- [ ] **T14 [CORE] Money: arithmetic**
  `add`, `subtract`, `negate` returning new instances; `assertSameCurrency` throwing a domain error. `subtract` may produce a negative Money internally (the Wallet decides if it is allowed).
  Done when: no `number` anywhere in the file.

- [ ] **T15 [CORE] Money: comparisons and string forms**
  `isZero`, `isPositive`, `isNegative`, `isLessThan`, `equals`, `toString`.
  Done when: cross-currency comparison throws.

- [ ] **T16 Money unit tests**
  Scale, rounding behavior (no silent rounding: reject), invalid inputs table, immutability, currency conflict, large values, `0.10 + 0.20 === 0.30`.
  Done when: all cases pass.

- [ ] **T17 FailureCode taxonomy**
  Enum with stable machine-readable codes. At minimum: `INSUFFICIENT_FUNDS`, `REVERSAL_WOULD_OVERDRAW`, `REFERENCE_NOT_FOUND`, `REFERENCE_ALREADY_REVERSED`, `REFERENCE_MISMATCH`, `INVALID_REFERENCE_KIND`, `REFERENCE_NOT_PROCESSED`, `AMOUNT_MISMATCH`, `CURRENCY_MISMATCH`, `WALLET_NOT_FOUND`, `REFERENCE_REQUIRED`, `INTERNAL_PERMANENT_ERROR` (FAILED only). Add a doc comment per code: who should do what (resend / fix payload / give up).
  Done when: each code states its retry guidance.

- [ ] **T18 Domain errors**
  `InvalidMoneyError`, `CurrencyMismatchError`, `InvalidTransactionStateError`, `InvariantViolationError`. Programmer errors are exceptions; business rejections are NOT exceptions.
  Done when: errors carry a stable `code`.

- [ ] **T19 [CORE] WalletLedgerEntry**
  Immutable. `create` validates `balanceBefore ± money === balanceAfter` and direction; `rehydrate`; `isBalanced()`. No setters, no transition methods.
  Done when: unbalanced creation throws; tests cover DEBIT and CREDIT.

- [ ] **T20 [CORE] Wallet: open and rehydrate**
  `Wallet.open` (version 1, currency from initial balance), `rehydrate`, getters. Negative initial balance rejected.
  Done when: tests cover creation and rehydrate (no revalidation of transitions).

- [ ] **T21 [CORE] Wallet: debit and credit**
  `debit(money, transactionId, now)` and `credit(...)` return the new `WalletLedgerEntry`, update balance, increment `version` only when the balance changes. Debit that would go negative returns/throws a domain result the use case can map to `INSUFFICIENT_FUNDS`. Currency mismatch throws.
  Done when: tests cover insufficient funds, exact-zero balance, currency mismatch, version increments.

- [ ] **T22 [CORE] WagerTransaction: kinds, statuses, create**
  Enums, `create` (born `PENDING`), `rehydrate`, `requiresReference()` (REFUND, ROLLBACK), `affectsBalance()` (false for LOSS). Reject missing reference when required. Reject `OPENING` from external creation (separate internal factory for opening).
  Done when: tests cover each kind.

- [ ] **T23 [CORE] WagerTransaction: state transitions**
  `markProcessed`, `markPendingReference`, `reject`, `fail`, `isTerminal`. Terminal states (`PROCESSED`, `REJECTED`, `FAILED`) throw `InvalidTransactionStateError` on any transition. Write the transition table as a comment above the class: `PENDING -> PROCESSED | PENDING_REFERENCE | REJECTED | FAILED`, `PENDING_REFERENCE -> PROCESSED | REJECTED | FAILED`.
  Done when: a test iterates every (from, action) pair.

- [ ] **T24 WagerTransaction: ledger direction and payload match**
  `ledgerDirectionFor(reference?)`: BET debit; WIN, REFUND credit; ROLLBACK inverse of the reference (reference BET -> credit, WIN -> debit, REFUND -> debit). `matchesPayload(hash)`.
  Done when: table-driven test covers every ROLLBACK reference kind.

- [ ] **T25 Canonical payload hash**
  Pure function: canonical JSON (recursively sorted keys, no whitespace) of business fields only (`providerId, externalTransactionId, playerId, walletId, roundId, gameId, kind, money`), sha256 hex. Header and transport metadata excluded. Document the algorithm in a comment.
  Done when: key order does not change the hash; changing amount changes it; extra transport fields do not.

- [ ] **T26 [CORE] Reversal policy**
  Pure domain function that validates a reversal against its reference: allowed kinds (REFUND -> BET only; ROLLBACK -> BET, WIN, REFUND), reference is `PROCESSED`, same provider, player, wallet, currency, round, equal amount. Returns a `FailureCode` or ok.
  Done when: one test per failure code.

- [ ] **T27 InboxMessage**
  `receive`, `rehydrate`, `isProcessed`, `markProcessed`. Cannot mark processed twice.
  Done when: tests pass.

- [ ] **T28 OutboxMessage**
  `enqueue(event)`, `isPending`, `isDue(now)`, `markPublished`, `scheduleRetry(now)` with exponential backoff (base and cap as constants, documented with a DECISION comment).
  Done when: tests cover the backoff sequence and the cap.

- [ ] **T29 IntegrationEvent and concrete events**
  Abstract base + `WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged`, `WagerTransactionPendingReference`. `data` carries `MoneyProps` strings, never `Money`. `toJSON` matches the README envelope.
  Done when: snapshot test of each `toJSON()`.

---

## Phase 2: Persistence

- [ ] **T30 MikroORM setup**
  Install `@mikro-orm/core`, `postgresql`, `nestjs`, `migrations`. Config with env, Nest module, connection check. Add a DECISION comment on why MikroORM (Unit of Work, `transactional`, `LockMode`).
  Done when: app connects to Postgres in compose.

- [ ] **T31 Migration: wallets**
  Columns: `id uuid PK`, `player_id`, `currency char(3)`, `balance numeric(19,2)`, `version int`, `created_at`, `updated_at`. `UNIQUE(player_id, currency)`, `CHECK (balance >= 0)`. Reversible `down`.
  Done when: up and down both run.

- [ ] **T32 Migration: wager_transactions**
  Columns for every field in the README plus `resulting_balance numeric(19,2) NULL`, `failure_code`, `processed_at`, `pending_attempts int`, `next_attempt_at`. `UNIQUE(idempotency_key)`, `UNIQUE(provider_id, external_transaction_id)`, CHECK on status/kind values, CHECK that REFUND/ROLLBACK have a reference external id, CHECK `amount >= 0`. Index for due `PENDING_REFERENCE`.
  Done when: up and down both run.

- [ ] **T33 Migration: wallet_ledger_entries**
  Columns per README. `UNIQUE(wallet_id, transaction_id)`, CHECKs (`balance_after = balance_before +/- amount` by direction, amount > 0, balance_after >= 0). Trigger that raises on `UPDATE` and `DELETE`. Index `(wallet_id, created_at, id)` for cursor pagination.
  Done when: an UPDATE and a DELETE both fail in a test.

- [ ] **T34 Migration: inbox and outbox**
  `inbox_messages` PK `(consumer_name, message_id)`. `outbox_messages` with `attempts`, `next_attempt_at`, `published_at`, partial index on unpublished rows.
  Done when: up and down both run.

- [ ] **T35 Migration: single reversal per reference**
  Partial `UNIQUE` index on `wager_transactions(reference_transaction_id) WHERE status = 'PROCESSED' AND reference_transaction_id IS NOT NULL`.
  Done when: inserting two processed reversals of the same reference fails.

- [ ] **T36 Migration roundtrip test**
  Test: empty DB -> up -> down -> up works.
  Done when: test is green in integration suite.

- [ ] **T37 Money persistence mapping**
  Custom type or mapper: `numeric` string + `currency` column <-> `Money`. Postgres returns `numeric` as string, never parse to number.
  Done when: roundtrip test for `"0.10"`, `"1234567.89"`.

- [ ] **T38 Persistence models and mappers**
  ORM entities live in `infrastructure` only. Mappers convert model <-> domain via `rehydrate`. Domain classes get no decorators.
  Done when: mapper tests for wallet, transaction, ledger entry.

- [ ] **T39 Test harness and invariant checker**
  Integration helpers: fresh schema per suite, factories, and `assertLedgerInvariant(walletId)`: wallet balance == sum of credits - debits, each entry balanced, entries chain correctly. Reused by every later test.
  Done when: helper has its own test.

- [ ] **T40 [CORE] WalletRepository**
  `findByIdForUpdate` (PESSIMISTIC_WRITE), `findById`, `findByPlayerAndCurrency`, `insert`, `saveBalance` (updates balance, version, updated_at).
  Done when: integration test proves a second transaction blocks on the lock.

- [ ] **T41 WagerTransactionRepository**
  `insert`, `findById`, `findByIdempotencyKey`, `findByProviderAndExternalId`, `update`, `findDuePendingReferenceForUpdateSkipLocked(limit)`, `findProcessedReversalOf(referenceId)`.
  Done when: integration tests cover each query.

- [ ] **T42 LedgerRepository**
  `insert`, `listByWallet(cursor, limit)` (opaque cursor = base64 of `(created_at, id)`), `sumByWallet`.
  Done when: pagination test with 120 entries, no duplicates or gaps.

- [ ] **T43 Inbox and Outbox repositories**
  Inbox: `tryInsert` (`ON CONFLICT DO NOTHING`, returns whether it was new), `markProcessed`. Outbox: `insert`, `lockDueBatchSkipLocked(limit, now)`, `markPublished`, `scheduleRetry`.
  Done when: integration tests, including two concurrent `lockDueBatch` calls returning disjoint rows.

- [ ] **T44 [CORE] UnitOfWork**
  Port in `application`; MikroORM implementation wrapping `em.transactional`. Everything inside shares one transaction.
  Done when: test proves rollback of wallet, ledger, inbox and outbox together on a thrown error.

- [ ] **T45 Constraint tests**
  One integration test per constraint from T31 to T35 (negative balance, duplicate wallet, duplicate idempotency key, duplicate external id, ledger update/delete, second reversal, unbalanced ledger entry).
  Done when: each constraint fails as expected against real Postgres.

---

## Phase 3: Use cases (application layer)

- [ ] **T46 Ports and result types**
  `SubmitResult` (processed | rejected | pendingReference, plus `idempotentReplay`), clock port, id generator port (UUID v7), event context.
  Done when: types compile; no infra imports.

- [ ] **T47 CreateWallet**
  Creates wallet; if initial balance > 0, creates internal `OPENING` transaction (PROCESSED) and CREDIT ledger entry in the SAME transaction. Duplicate `(playerId, currency)` -> conflict result.
  Done when: unit test with fakes plus integration test with real DB.

- [ ] **T48 Query use cases**
  `GetWallet`, `GetLedger`, `GetTransactionById`, `GetTransactionByProviderExternalId`.
  Done when: unit tests.

- [ ] **T49 [CORE] SubmitWagerTransaction: skeleton and idempotency**
  Inside UnitOfWork: lock wallet first, then lookup by idempotency key. Same key + same hash -> return stored result with `idempotentReplay: true` (using stored `resulting_balance`). Same key + different hash -> idempotency conflict. Add `// DECISION:` comment on lock-before-lookup.
  Done when: tests for first call, replay, conflict.

- [ ] **T50 [CORE] BET**
  Debit, ledger entry, mark PROCESSED, store `resulting_balance`. Insufficient funds -> REJECTED with `INSUFFICIENT_FUNDS`, no ledger, no balance change.
  Done when: unit tests for both paths.

- [ ] **T51 [CORE] WIN and LOSS**
  WIN credits. LOSS marks PROCESSED with no ledger, no balance change, no `WalletBalanceChanged`.
  Done when: tests assert no ledger row for LOSS.

- [ ] **T52 [CORE] REFUND**
  Resolve reference by `(providerId, referenceExternalTransactionId)`, apply `ReversalPolicy`, credit. Reference not `PROCESSED` (still pending) is handled like a missing reference.
  Done when: tests for success and each rejection code.

- [ ] **T53 [CORE] ROLLBACK**
  Same resolution; direction is the inverse of the reference. If the inverse debit would make the balance negative -> REJECTED with `REVERSAL_WOULD_OVERDRAW`, auditable, no ledger.
  Done when: tests for rollback of BET, WIN and REFUND, plus overdraw.

- [ ] **T54 [CORE] Reference not found -> PENDING_REFERENCE**
  Persist as `PENDING_REFERENCE` with `next_attempt_at`, emit `WagerTransactionPendingReference`, return pending result.
  Done when: test covers the persisted state and the event.

- [ ] **T55 [CORE] Outbox events inside the same transaction**
  Emit `WagerTransactionProcessed` (including LOSS), `WagerTransactionRejected`, `WalletBalanceChanged` (only when balance changes), `WagerTransactionPendingReference`. `correlationId` and `causationId` propagated.
  Done when: tests assert which events exist per kind.

- [ ] **T56 [CORE] Race on idempotency key across wallets**
  If the insert hits the UNIQUE constraint (same key sent with different wallets in parallel), catch the violation, reload by key, and resolve as replay or conflict.
  Done when: integration test with parallel requests, same key, two wallets.

- [ ] **T57 Use case unit test sweep**
  Fill gaps: currency conflict, `OPENING` from outside rejected, payload validation at the use case boundary, FAILED path for permanent infra error.
  Done when: every `FailureCode` is produced by at least one test.

- [ ] **T58 [CORE] ReprocessPendingReference use case**
  For one due transaction: retry resolution. Resolved -> process normally. Still missing and attempts/TTL exhausted -> REJECTED `REFERENCE_NOT_FOUND` + `WagerTransactionRejected` event. Else schedule next attempt with exponential backoff. Choose limits (suggested: max 8 attempts, base 5s, cap 5min, TTL 1h) and justify with a `// DECISION:` comment.
  Done when: tests for the three outcomes.

- [ ] **T59 ReconcileWallet**
  Recompute balance from ledger, compare with stored, return the README response shape. On divergence: log at error level, increment a metric, `consistent: false`. Never fix silently.
  Done when: test with a deliberately corrupted balance.

---

## Phase 4: HTTP

- [ ] **T60 Error mapping**
  Global exception filter and a result-to-HTTP mapper implementing the fixed status table. Error body: `{ code, message, retryable }`.
  Done when: unit tests per mapping; table copied into a comment.

- [ ] **T61 Request validation**
  Validate at the edge (ask before adding a lib; prefer what Nest already offers). Invalid payload -> 400 with `code`. `Idempotency-Key` header required.
  Done when: tests for missing header, invalid money, unknown kind, `OPENING`.

- [ ] **T62 POST /wallets**
  201 with README body; duplicate -> 409.
  Done when: e2e test against real DB.

- [ ] **T63 GET /wallets/:walletId**
  Done when: e2e test, 404 for unknown id.

- [ ] **T64 POST /wagering/transactions**
  Calls `SubmitWagerTransaction`. Returns README body; 200/201 processed, 202 pending, 422 rejected, 409 conflict.
  Done when: e2e tests for each status.

- [ ] **T65 GET transaction endpoints**
  By id and by `providerId + externalTransactionId`.
  Done when: e2e tests.

- [ ] **T66 GET /wallets/:walletId/ledger**
  Opaque cursor, `limit` default 50, max 200. Invalid cursor -> 400.
  Done when: e2e pagination test.

- [ ] **T67 POST /wallets/:walletId/reconciliation**
  Done when: e2e for consistent and corrupted cases.

- [ ] **T68 Health**
  `/health/live` (process only), `/health/ready` (Postgres + SQS reachable, 503 otherwise). No auth.
  Done when: test stops Postgres and sees 503 on ready, 200 on live.

- [ ] **T69 Auth extension point**
  No-op `AuthGuard` applied globally with health excluded, `ProviderIdentityPort` interface, short note in ARCHITECTURE.md draft explaining the chosen design (e.g. Keycloak/OIDC, provider identity from token claim must match `providerId`).
  Done when: guard exists, is wired, documented.

---

## Phase 5: SQS consumer

- [ ] **T70 SQS port and adapter**
  `MessageQueue` port (receive, ack, change visibility, send) and AWS SDK v3 adapter for LocalStack.
  Done when: integration test sends and receives on the FIFO queue.

- [ ] **T71 Message schema and validation**
  Parse the README message. Invalid or `OPENING` -> classified as permanent (DLQ path). `idempotencyKey` comes from the message.
  Done when: unit tests.

- [ ] **T72 [CORE] Consumer: inbox dedupe + same use case**
  In ONE transaction: `inbox.tryInsert(consumerName, messageId)`; if not new and processed -> ack without effects; else run the same `SubmitWagerTransaction` logic and `markProcessed`. Payload hash stored in inbox.
  Done when: redelivered message produces no second effect.

- [ ] **T73 [CORE] Ack after commit and error classification**
  Business outcome (processed/rejected/pending) -> ack. Transient (DB down, lock timeout) -> do not ack, set visibility with backoff. Permanent (malformed, impossible) -> send to DLQ after the limit. Document the classification table.
  Done when: tests per class.

- [ ] **T74 Retry limit and DLQ**
  Use `ApproximateReceiveCount`; at the limit, move to DLQ with failure reason. Persist a `FAILED` transaction when the transaction identity is known (auditable).
  Done when: integration test ends with the message in DLQ.

- [ ] **T75 Graceful shutdown**
  On SIGTERM: stop polling, finish in-flight messages, return visibility of unstarted ones, close connections.
  Done when: test sends SIGTERM mid-processing, no lost or duplicated effect.

- [ ] **T76 Consumer integration tests**
  Redelivery, crash before ack (kill after commit), DLQ, FIFO group = walletId.
  Done when: all pass with real Postgres and LocalStack.

---

## Phase 6: Outbox publisher and workers

- [ ] **T77 [CORE] Outbox publisher**
  Loop: in a transaction `lockDueBatchSkipLocked`, publish to `wager-events`, `markPublished`. Failure -> `scheduleRetry`. Publishing is at-least-once; consumers dedupe by `eventId`. Add `// DECISION:` on at-least-once.
  Done when: unit test with fake queue plus integration test.

- [ ] **T78 Scheduler wiring**
  Run publisher and pending-reference worker on intervals from config, safe with N instances (no leader election; SKIP LOCKED is the coordination). No overlapping runs inside one process.
  Done when: two instances in compose do not double-process.

- [ ] **T79 Pending reference worker**
  Picks due `PENDING_REFERENCE` rows with SKIP LOCKED, calls `ReprocessPendingReference`.
  Done when: integration test: ROLLBACK first, BET later, ROLLBACK ends PROCESSED.

- [ ] **T80 Worker integration tests**
  Two publishers on the same outbox publish each event at least once and never get stuck; exhausted reference ends REJECTED with event.
  Done when: all pass.

---

## Phase 7: Observability

- [ ] **T81 Structured logging**
  JSON logger, `AsyncLocalStorage` context with `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`. Redaction: never log full payloads or amounts beyond what is needed.
  Done when: test asserts log shape and absence of payload.

- [ ] **T82 Metrics**
  `prom-client`, `/metrics`. Counters/histograms: transactions by status, duplicates detected, retries, DLQ messages, lock conflicts/timeouts, outbox lag, processing latency, reconciliation divergences.
  Done when: each metric is incremented in at least one test.

- [ ] **T83 Wire logs and metrics into flows**
  HTTP, consumer, publisher, workers.
  Done when: a manual run shows correlated logs across HTTP -> outbox -> publish.

---

## Phase 8: Concurrency and failure tests (real parallelism)

- [ ] **T84 Multi-instance harness**
  Helper to start N app processes (separate Bun processes or compose scale) against the same Postgres/LocalStack, wait for ready, stop them.
  Done when: harness boots 3 instances.

- [ ] **T85 Same bet 50x in parallel**
  Done when: exactly one debit, 49 replays, invariant holds.

- [ ] **T86 Mandatory scenario**
  Balance 100.00, two BETs of 80.00 simultaneously: one PROCESSED, one REJECTED, balance 20.00, one DEBIT entry, retries do not duplicate.
  Done when: green and repeated 20 times without flake.

- [ ] **T87 Different wallets in parallel**
  Done when: N wallets processed concurrently, no cross-blocking beyond DB capacity, invariants hold for all.

- [ ] **T88 Three or more instances**
  Mixed HTTP and SQS load on the same hot wallet.
  Done when: invariant holds, no negative balance.

- [ ] **T89 Worker killed after commit, before ack**
  `kill -9` after commit; message redelivered; no duplicate effect.
  Done when: green.

- [ ] **T90 Two publishers, same outbox**
  Done when: no event lost; duplicates (if any) are safe by `eventId`.

- [ ] **T91 Reversal before reference**
  ROLLBACK and REFUND delivered before their BET, in parallel with the BET.
  Done when: final state correct and single-reversal rule holds under race.

- [ ] **T92 Concurrent reversals of the same reference**
  Two ROLLBACKs (and REFUND + ROLLBACK) of the same BET in parallel -> exactly one PROCESSED.
  Done when: green.

- [ ] **T93 Restart consistency**
  Stop all instances mid-load, restart, wait for drain, run `assertLedgerInvariant` on every wallet.
  Done when: `wallet.balance == ledger-derived balance` for all wallets.

- [ ] **T94 Postgres/SQS outage tests**
  Pause Postgres container during processing; transient errors retried, nothing lost. Same for LocalStack during publishing.
  Done when: green.

---

## Phase 9: Documentation and polish

- [ ] **T95 README.md**
  Setup in one command (`docker compose up`), how to run each test suite, example `curl` calls, env vars.
  Done when: a fresh clone works following only the README.

- [ ] **T96 ARCHITECTURE.md: decisions**
  ORM choice, Money mapping, transaction strategy, lock choice and alternatives rejected, idempotency design and hash algorithm, inbox/outbox, status mapping, queue classification, backoff/limits, auth decision, reversal interpretation.
  Done when: every `// DECISION:` comment is reflected.

- [ ] **T97 ARCHITECTURE.md: invariant matrix and failure codes**
  Table: invariant -> where enforced (code, DB constraint) -> test that proves it. Table of `FailureCode` with retry guidance. Transition table of `WagerTransaction`.
  Done when: no invariant without a test.

- [ ] **T98 ARCHITECTURE.md: limitations and trade-offs**
  Honest section: what is not handled, what would change at scale (partitioning, hot-wallet throughput), what was cut and why.
  Done when: at least 5 concrete limitations.

- [ ] **T99 Comment pass**
  Review `DECISION` / `INVARIANT` / `RISK` comments in the vital files (Money, Wallet, Submit use case, repositories with locks, migrations, consumer, publisher). Remove comments that restate code.
  Done when: each vital file explains its reasoning.

- [ ] **T100 Eliminatory checklist audit**
  Verify, with evidence (grep/test names), each eliminatory failure from the README: no `number` money, no negative balance race, no duplicate debit/credit, no in-memory idempotency, correct with multiple instances, no event before commit, auditable ledger, no full mocks of Postgres/SQS.
  Done when: checklist added to ARCHITECTURE.md with links to tests.

- [ ] **T101 (Optional) Load test**
  `bun run test:load`: environment, methodology, throughput, p50/p95/p99, error rate, lock conflicts, outbox lag, and an honest analysis.
  Done when: results documented, numbers reproducible.

- [ ] **T102 [HUMAN] Final review and submission**
  Read the whole diff, run everything from a clean clone, prepare the presentation talking points from the `DECISION` comments.
  Done when: submitted.