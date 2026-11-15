import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Money } from "../../../src/domain/money/money";
import { Wallet } from "../../../src/domain/wallet/wallet";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import {
  isTransientDatabaseError,
  lockConflictKind,
} from "../../../src/infrastructure/persistence/transient-database-error";
import { toErrorReply } from "../../../src/interfaces/http/errors/global-exception.filter";
import { FIXED_NOW } from "../../support/factories";
import { RecordingMetrics } from "../../support/fakes";
import { createTestDatabase, type TestDatabase } from "../../support/test-database";

const LOCK_TIMEOUT_MS = 300;
let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.dispose();
});

async function newWallet(): Promise<string> {
  const wallet = Wallet.open({
    id: crypto.randomUUID(),
    playerId: `player-${crypto.randomUUID()}`,
    initialBalance: Money.zero("BRL"),
  });
  await new MikroOrmUnitOfWork(db.orm).run((repositories) =>
    repositories.wallets.insert(wallet, FIXED_NOW),
  );
  return wallet.id;
}

// Segura o lock da carteira até `release` ser chamado.
function holdLock(walletId: string): {
  locked: Promise<void>;
  release: () => void;
  done: Promise<void>;
} {
  let release = () => undefined as void;
  let markLocked = () => undefined as void;
  const locked = new Promise<void>((resolve) => (markLocked = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const done = new MikroOrmUnitOfWork(db.orm).run(async (repositories) => {
    await repositories.wallets.findByIdForUpdate(walletId);
    markLocked();
    await released;
  });
  return { locked, release, done };
}

describe("wallet lock timeout", () => {
  test("a wallet held longer than lock_timeout fails fast as a transient lock timeout (503)", async () => {
    const walletId = await newWallet();
    const holder = holdLock(walletId);
    await holder.locked;
    const contender = new MikroOrmUnitOfWork(db.orm, { lockTimeoutMs: LOCK_TIMEOUT_MS });

    const startedAt = performance.now();
    const error = await contender
      .run((repositories) => repositories.wallets.findByIdForUpdate(walletId))
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    const waitedMs = performance.now() - startedAt;
    holder.release();
    await holder.done;

    expect(error).not.toBeNull();
    expect(lockConflictKind(error)).toBe("lock_timeout");
    expect(isTransientDatabaseError(error)).toBe(true);
    expect(toErrorReply(error)).toMatchObject({ status: 503, body: { retryable: true } });
    expect(waitedMs).toBeLessThan(5_000);
  });

  test("records how long the wallet lock took to be granted", async () => {
    const walletId = await newWallet();
    const metrics = new RecordingMetrics();
    const holder = holdLock(walletId);
    await holder.locked;
    const contender = new MikroOrmUnitOfWork(db.orm, { metrics });

    const waiting = contender.run((repositories) =>
      repositories.wallets.findByIdForUpdate(walletId),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    holder.release();
    await holder.done;
    await waiting;

    const waits = metrics.observations.filter((entry) => entry.name === "wallet_lock_wait_seconds");
    expect(waits).toHaveLength(1);
    expect(waits[0]?.seconds ?? 0).toBeGreaterThanOrEqual(0.15);
  });
});
