import pluginJs from "@eslint/js";
import regexp_plugin from "eslint-plugin-regexp";
import security from "eslint-plugin-security";
import globals from "globals";
import ts_eslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ["src/**/*.ts", "scripts/*.js", "scripts/*.mjs", "scripts/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: [
      "build",
      "coverage",
      "dist",
      "docs",
      "*.cts",
      "*.cjs",
      "**/*.cjs",
    ],
  },
  pluginJs.configs.recommended,
  ...ts_eslint.configs.recommended,
  ...ts_eslint.configs.strict,
  regexp_plugin.configs["flat/recommended"],
  {
    plugins: {
      security,
    },
    rules: {
      "@typescript-eslint/no-shadow": "error",
      "security/detect-object-injection": "warn",
      "security/detect-non-literal-require": "warn",
      "security/detect-eval-with-expression": "error",
      "security/detect-non-literal-regexp": "warn",
      "security/detect-unsafe-regex": "error",
      "security/detect-buffer-noassert": "error",
      "security/detect-child-process": "warn",
      "security/detect-disable-mustache-escape": "error",
      "security/detect-no-csrf-before-method-override": "error",
      "security/detect-possible-timing-attacks": "warn",
      "security/detect-pseudoRandomBytes": "error",
    },
  },
  {
    files: ["scripts/*.ts", "scripts/*.*js"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
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
