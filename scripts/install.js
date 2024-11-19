#!/usr/bin/env node

// scripts/install.js

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { arch, platform } from "node:os";
import { basename, dirname, join } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";
import { configure } from "./configure.js"; // Import the configure function

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const desc = join(basename(__dirname), basename(__filename));

const prebuildName = `${platform()}-${arch()}`;
const prebuildPath = join(__dirname, "..", "prebuilds", prebuildName);

// Skip build if prebuilt binary exists
if (existsSync(prebuildPath)) {
  console.log(
    `${desc}: skipping build: found prebuilt binary: ${prebuildPath}`,
  );
  exit(0);
}

// Otherwise build from source

console.log(`${desc}: running configure.js...`);
try {
  configure();
} catch (error) {
  console.error(`${desc}: configure.js failed: ${error}`);
  exit(1);
}

const result = spawnSync("node-gyp", ["configure", "build"], {
  stdio: "inherit",
  shell: true,
});

if (result.status !== 0) {
  console.error(`${desc}: failed to build native module`);
  exit(1);
}
