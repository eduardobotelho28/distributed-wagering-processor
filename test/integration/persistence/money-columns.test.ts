import { afterAll, beforeAll, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import { Money } from "../../../src/domain/money/money";
import { InvalidMoneyError } from "../../../src/domain/money/invalid-money.error";
import { loadConfig } from "../../../src/infrastructure/config/app-config";
import { buildMikroOrmOptions } from "../../../src/infrastructure/persistence/mikro-orm.config";
import {
  moneyFromColumns,
  moneyToColumns,
} from "../../../src/infrastructure/persistence/money-columns";

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init(buildMikroOrmOptions(loadConfig(process.env).database.url));
  await orm.migrator.up();
});

afterAll(async () => {
  await orm.close();
});

class Rollback extends Error {}

async function roundtrip(money: Money): Promise<{ raw: unknown; money: Money }> {
  let result: { raw: unknown; money: Money } | undefined;
  await orm.em
    .fork()
    .transactional(async (em) => {
      const conn = em.getConnection();
      const ctx = em.getTransactionContext();
      const id = crypto.randomUUID();
      const columns = moneyToColumns(money);
      await conn.execute(
        `insert into wallets (id, player_id, currency, balance, created_at, updated_at)
         values (?, ?, ?, ?, now(), now())`,
        [id, `player-${id}`, columns.currency, columns.amount],
        "run",
        ctx,
      );
      const rows = await conn.execute<{ balance: unknown; currency: unknown }[]>(
        `select balance, currency from wallets where id = ?`,
        [id],
        "all",
        ctx,
      );
      const row = rows[0];
      if (row === undefined) throw new Error("row not found");
      result = {
        raw: row.balance,
        money: moneyFromColumns({ amount: row.balance, currency: row.currency }),
      };
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  if (result === undefined) throw new Error("roundtrip did not run");
  return result;
}

for (const amount of ["0.10", "1234567.89"]) {
  test(`roundtrips ${amount} through numeric(19,2) without losing precision`, async () => {
    const original = Money.from({ amount, currency: "BRL" });

    const { raw, money } = await roundtrip(original);

    expect(typeof raw).toBe("string");
    expect(raw).toBe(amount);
    expect(money.toJSON()).toEqual({ amount, currency: "BRL" });
    expect(money.equals(original)).toBe(true);
  });
}

test("rejects a numeric amount coming from persistence", () => {
  expect(() => moneyFromColumns({ amount: 0.1, currency: "BRL" })).toThrow(InvalidMoneyError);
});
