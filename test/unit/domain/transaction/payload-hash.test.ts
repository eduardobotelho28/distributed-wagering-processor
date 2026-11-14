import { describe, expect, test } from "bun:test";
import { Money } from "../../../../src/domain/money/money";
import { computePayloadHash } from "../../../../src/domain/transaction/payload-hash";
import { TransactionKind } from "../../../../src/domain/transaction/transaction-kind";

function payload() {
  return {
    providerId: "prov-1",
    externalTransactionId: "ext-1",
    playerId: "player-1",
    walletId: "wallet-1",
    roundId: "round-1",
    gameId: "game-1",
    kind: TransactionKind.BET,
    money: Money.from({ amount: "10.00", currency: "BRL" }),
  };
}

describe("computePayloadHash", () => {
  test("returns a sha256 hex digest", () => {
    expect(computePayloadHash(payload())).toMatch(/^[0-9a-f]{64}$/);
  });

  test("key order does not change the hash", () => {
    const original = payload();
    const reordered = {
      money: original.money,
      kind: original.kind,
      gameId: original.gameId,
      roundId: original.roundId,
      walletId: original.walletId,
      playerId: original.playerId,
      externalTransactionId: original.externalTransactionId,
      providerId: original.providerId,
    };
    expect(computePayloadHash(reordered)).toBe(computePayloadHash(original));
  });

  test("changing the amount changes the hash", () => {
    const changed = { ...payload(), money: Money.from({ amount: "10.01", currency: "BRL" }) };
    expect(computePayloadHash(changed)).not.toBe(computePayloadHash(payload()));
  });

  test("equivalent amount strings hash the same", () => {
    const short = { ...payload(), money: Money.from({ amount: "10", currency: "BRL" }) };
    expect(computePayloadHash(short)).toBe(computePayloadHash(payload()));
  });

  test("extra transport fields do not change the hash", () => {
    const withTransport = { ...payload(), headers: { traceId: "t-1" }, receivedAt: "now" };
    expect(computePayloadHash(withTransport)).toBe(computePayloadHash(payload()));
  });

  test("changing a business field changes the hash", () => {
    const changed = { ...payload(), roundId: "round-2" };
    expect(computePayloadHash(changed)).not.toBe(computePayloadHash(payload()));
  });
});
