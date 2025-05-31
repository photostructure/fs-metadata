import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true, // Generate .d.ts files automatically
  clean: true, // Clean dist before each build
  sourcemap: true,
  outExtension: ({ format }) => ({
    js: format === "cjs" ? ".cjs" : ".mjs", // Use .cjs for CommonJS and .mjs for ESM
  }),
  shims: true, // Inject CJS shims (__dirname, __filename) in ESM output
  target: "es2022", // Align with TypeScript target
  tsconfig: "tsconfig.build.json", // Use a single tsconfig for building
});
