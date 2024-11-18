import pluginJs from "@eslint/js";
import ts_eslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  { files: ["src/**/*.ts", "scripts/*.js", "*.js"] },
  { ignores: [".tsup", "build", "coverage", "dist", "docs"] },
  pluginJs.configs.recommended,
  ...ts_eslint.configs.recommended,
];
