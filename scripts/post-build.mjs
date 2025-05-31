#!/usr/bin/env node

import { copyFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

// Copy .d.ts to .d.cts for CommonJS type safety
async function createCjsTypes() {
  try {
    await copyFile(join(distDir, "index.d.ts"), join(distDir, "index.d.cts"));
    console.log("Created index.d.cts for CommonJS type safety");
  } catch (error) {
    console.error("Error creating .d.cts file:", error);
    process.exit(1);
  }
}

createCjsTypes();
