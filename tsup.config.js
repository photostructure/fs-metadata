// @ts-check
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  target: "es2023",
  clean: true,
  format: ["esm"],
  experimentalDts: true,
  // 7.5kB minified, 14.5kB non-minified. Not worth.
  // minify: "terser",
});
