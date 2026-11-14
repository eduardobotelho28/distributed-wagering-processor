import tseslint from "typescript-eslint";

// DECISION: money must never pass through JS floats. These bans make the
// AGENTS.md hard rule mechanical instead of relying on review.
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
