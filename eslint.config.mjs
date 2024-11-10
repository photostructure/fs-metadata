import ts_eslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ["src/**/*.ts}"],
  },
  ...ts_eslint.configs.recommended,
];