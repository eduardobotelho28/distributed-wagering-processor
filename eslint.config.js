import tseslint from "typescript-eslint";

// Aqui validamos algumas coisas no próprio LINT, isto impede o uso de floats, Number.parseFloat, etc.. Por óbvio, isto é apenas uma camada a mais de qualidade e não substitui as validações feitas no Domínio, que são mais robustas e completas. O LINT é apenas uma camada de segurança para evitar que alguém use floats por engano.

const floatMoneyBans = {
  "no-restricted-globals": [
    "error",
    { name: "parseFloat", message: "Float parsing is banned. Use Money (Decimal)." },
  ],
  "no-restricted-properties": [
    "error",
    {
      object: "Number",
      property: "parseFloat",
      message: "Float parsing is banned. Use Money (Decimal).",
    },
    { property: "toFixed", message: "toFixed rounds floats. Use Money (Decimal)." },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "CallExpression[callee.name='Number']",
      message: "Number() coerces to float. Use Money (Decimal).",
    },
  ],
};

// Aqui configurei para que o LINT valide as fronteiras entre os módulos, para evitar que alguém importe algo de outro módulo que não deveria. Por exemplo, o domínio não pode importar nada da infraestrutura ou das interfaces, e a aplicação não pode importar nada da infraestrutura ou das interfaces também. Isso ajuda a manter a arquitetura limpa e respeitar as camadas do sistema.

const outerLayerSegment = "(^|/)(application|infrastructure|interfaces)(/|$)";
const srcRootModule = "(^|/)(app\\.module|main)(\\.ts)?$";

const domainBoundaries = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["@nestjs/*", "@mikro-orm/*"],
          message: "domain is pure TS: no framework or ORM imports.",
        },
        {
          regex: outerLayerSegment,
          message: "domain cannot import from outside domain.",
        },
        {
          regex: srcRootModule,
          message: "domain cannot import from outside domain.",
        },
      ],
    },
  ],
};

const applicationBoundaries = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          regex: "(^|/)(infrastructure|interfaces)(/|$)",
          message: "application depends on ports, not on infrastructure or interfaces.",
        },
        {
          regex: srcRootModule,
          message: "application cannot import the composition root.",
        },
      ],
    },
  ],
};

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "coverage/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: floatMoneyBans,
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: domainBoundaries,
  },
  {
    files: ["src/application/**/*.ts"],
    rules: applicationBoundaries,
  },
);
