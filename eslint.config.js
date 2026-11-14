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
);
