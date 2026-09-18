#!/usr/bin/env node

/**
 * Custom install script that handles Windows architecture defines
 * when node-gyp-build needs to compile from source.
 *
 * node-gyp-build is resolved through require.resolve and run with this
 * process's own interpreter, rather than spawned as `npx node-gyp-build`.
 *
 * An outer `npm install -g` exports npm_config_global=true, and a nested npx
 * inherits it. npx then treats its own bootstrap directory as a global
 * install, never writes $npm_config_cache/_npx/<hash>/package.json, and fails
 * reading the file it did not write -- exit 254 on POSIX, 127 on Windows.
 * Resolving the binary here re-enters neither npm nor the shell, so nothing in
 * npm's lifecycle environment can redirect it.
 */

const { spawnSync } = require("node:child_process");
const { platform, arch } = require("node:os");

// If in CI and on Windows, set architecture defines
if (process.env.CI && platform() === "win32") {
  const currentArch = arch();

  // Set architecture-specific defines for Windows
  if (currentArch === "x64") {
    process.env.CL = "/D_M_X64 /D_WIN64 /D_AMD64_";
  } else if (currentArch === "arm64") {
    process.env.CL = "/D_M_ARM64 /D_WIN64";
  }

  console.log(`Windows CI detected: arch=${currentArch}, CL=${process.env.CL}`);
}

// No env: option, so the child inherits process.env -- including the CL
// defines set above.
const result = spawnSync(
  process.execPath,
  [require.resolve("node-gyp-build/bin.js")],
  { stdio: "inherit" },
);

if (result.error) {
  console.error("Failed to run node-gyp-build:", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`node-gyp-build exited with code ${result.status}`);
  process.exit(result.status ?? 1);
}
