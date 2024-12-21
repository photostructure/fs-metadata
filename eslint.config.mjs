import pluginJs from "@eslint/js";
import globals from "globals";
import ts_eslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ["src/**/*.ts", "scripts/*.js"],
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
  {
    rules: {
      "@typescript-eslint/no-shadow": "error",
    },
  },
];
