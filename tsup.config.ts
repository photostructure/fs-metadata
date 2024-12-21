import { defineConfig } from "tsup";

export default defineConfig({
  outExtension: ({ format }) => ({
    js: format === "cjs" ? ".cjs" : ".mjs", // Use .cjs for CommonJS and .mjs for ESM
  }),
});
