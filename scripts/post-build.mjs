#!/usr/bin/env node

import { copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

// Copy .d.ts to .d.cts and .d.mts so each exports condition resolves to a
// declaration file whose module format matches its JavaScript counterpart.
//
// Without a .d.mts file, the `import` condition's types (`index.d.ts`) are
// interpreted as CommonJS (the package has no `"type": "module"`), while the
// resolved JavaScript (`index.mjs`) is ESM. That mismatch is the "Masquerading
// as CJS" / FalseCJS problem reported by arethetypeswrong. A .d.cts pairs with
// the CJS `.cjs` output; a .d.mts pairs with the ESM `.mjs` output.
async function createDualTypes() {
  try {
    await copyFile(join(distDir, "index.d.ts"), join(distDir, "index.d.cts"));
    console.log("Created index.d.cts for CommonJS type safety");
    await copyFile(join(distDir, "index.d.ts"), join(distDir, "index.d.mts"));
    console.log("Created index.d.mts for ESM type safety");
  } catch (error) {
    console.error("Error creating dual declaration files:", error);
    process.exit(1);
  }
}

createDualTypes();
