import { expect, test } from "bun:test";
import { UuidV7IdGenerator } from "../../../../src/infrastructure/time/uuid-v7-id-generator";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("generates UUID v7 ids in creation order", () => {
  const generator = new UuidV7IdGenerator();

  const ids = Array.from({ length: 50 }, () => generator.next());

  for (const id of ids) expect(id).toMatch(UUID_V7);
  expect([...ids].sort()).toEqual(ids);
});
