import pluginJs from "@eslint/js";
import ts_eslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  { files: ["src/**/*.ts", "scripts/*.js", "*.js"] },
  { ignores: ["dist", "build", ".tsup", "coverage"] },
  pluginJs.configs.recommended,
  ...ts_eslint.configs.recommended,
];
