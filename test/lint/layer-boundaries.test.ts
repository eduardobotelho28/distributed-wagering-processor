import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

const eslint = new ESLint();
const RULE = "no-restricted-imports";

async function ruleIdsFor(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.map((message) => message.ruleId ?? "") ?? [];
}

const domainFile = "src/domain/wallet/wallet.ts";
const applicationFile = "src/application/place-bet/place-bet.use-case.ts";

describe("domain boundaries", () => {
  test.each([
    'import { Injectable } from "@nestjs/common";',
    'import { Entity } from "@mikro-orm/core";',
    'import { x } from "../../application/ports/x";',
    'import { x } from "../../infrastructure/config/app-config";',
    'import { x } from "../../interfaces/http/x";',
    'import { AppModule } from "../../app.module";',
  ])("rejects %s", async (code) => {
    expect(await ruleIdsFor(domainFile, `${code}\nexport const y = x;\n`)).toContain(RULE);
  });

  test("accepts imports inside domain", async () => {
    const code = 'import { Money } from "../money/money";\nexport const y = Money;\n';
    expect(await ruleIdsFor(domainFile, code)).toEqual([]);
  });
});

describe("application boundaries", () => {
  test.each([
    'import { x } from "../../infrastructure/config/app-config";',
    'import { x } from "../../interfaces/http/x";',
  ])("rejects %s", async (code) => {
    expect(await ruleIdsFor(applicationFile, `${code}\nexport const y = x;\n`)).toContain(RULE);
  });

  test("accepts imports from domain and application", async () => {
    const code =
      'import { Money } from "../../domain/money/money";\n' +
      'import { Port } from "../ports/port";\n' +
      "export const y = [Money, Port];\n";
    expect(await ruleIdsFor(applicationFile, code)).toEqual([]);
  });
});
