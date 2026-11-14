import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

const eslint = new ESLint();

async function ruleIdsFor(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: "src/money-probe.ts" });
  return result?.messages.map((message) => message.ruleId ?? "") ?? [];
}

describe("money float ban in src", () => {
  test("rejects parseFloat", async () => {
    expect(await ruleIdsFor('export const x = parseFloat("1");\n')).toContain(
      "no-restricted-globals",
    );
  });

  test("rejects Number.parseFloat", async () => {
    expect(await ruleIdsFor('export const x = Number.parseFloat("1");\n')).toContain(
      "no-restricted-properties",
    );
  });

  test("rejects Number() coercion", async () => {
    expect(await ruleIdsFor('export const x = Number("1");\n')).toContain("no-restricted-syntax");
  });

  test("rejects toFixed", async () => {
    expect(await ruleIdsFor("export const x = (1).toFixed(2);\n")).toContain(
      "no-restricted-properties",
    );
  });

  test("accepts code without float money", async () => {
    expect(await ruleIdsFor('export const x = "25.00";\n')).toEqual([]);
  });
});
