import pluginJs from "@eslint/js";
import regexp_plugin from "eslint-plugin-regexp";
import globals from "globals";
import ts_eslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ["src/**/*.ts", "scripts/*.js", "scripts/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  { ignores: ["build", "coverage", "dist", "docs", "*.cts", "*.cjs"] },
  pluginJs.configs.recommended,
  ...ts_eslint.configs.recommended,
  ...ts_eslint.configs.strict,
  regexp_plugin.configs["flat/recommended"],
  {
    rules: {
      "@typescript-eslint/no-shadow": "error",
    },
  },
  {
    files: ["scripts/*.mjs"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.js", "**/*.test.mjs"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
];
