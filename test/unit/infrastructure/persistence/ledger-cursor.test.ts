import { describe, expect, test } from "bun:test";
import {
  decodeLedgerCursor,
  encodeLedgerCursor,
  InvalidLedgerCursorError,
} from "../../../../src/infrastructure/persistence/ledger-cursor";

describe("ledger cursor", () => {
  test("roundtrips created_at and id through an opaque string", () => {
    const cursor = { createdAt: new Date("2026-11-14T12:00:00.123Z"), id: "entry-1" };

    const encoded = encodeLedgerCursor(cursor);

    expect(encoded).not.toContain("entry-1");
    expect(decodeLedgerCursor(encoded)).toEqual(cursor);
  });

  test.each([
    "",
    "not-base64-$$$",
    Buffer.from("2026-11-14T12:00:00.000Z").toString("base64url"),
    Buffer.from("yesterday|entry-1").toString("base64url"),
    Buffer.from("2026-11-14T12:00:00.000Z|a|b").toString("base64url"),
  ])("rejects a malformed cursor %p", (encoded) => {
    expect(() => decodeLedgerCursor(encoded)).toThrow(InvalidLedgerCursorError);
  });
});
