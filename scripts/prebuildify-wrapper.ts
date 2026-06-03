#!/usr/bin/env tsx

import { spawn } from "node:child_process";
import { arch, platform } from "node:os";

/**
 * Wrapper for prebuildify to ensure architecture is explicitly passed This
 * works around the issue where prebuildify doesn't properly evaluate
 * binding.gyp conditions for Windows architecture defines
 *
 * NOTE: if you don't include <windows.h> in your binding.gyp, this script is
 * unnecessary.
 */

// Get the current architecture and platform
const currentArch = arch(); // 'x64', 'arm64', etc.
const currentPlatform = platform(); // 'win32', 'darwin', 'linux'

console.log(`Building for platform: ${currentPlatform}, arch: ${currentArch}`);

// Set up environment variables to help node-gyp
const env = { ...process.env };

// Architecture-specific compiler defines for Windows. Tracked in a local so we
// can log the value we set without reading it back out of the environment
// (which CodeQL flags as clear-text logging of process environment data).
let clDefines: string | undefined;

// Set architecture-specific defines for Windows
if (currentPlatform === "win32") {
  // Try various environment variables that might work
  env.npm_config_arch = currentArch;
  env.npm_config_target_arch = currentArch;
  env.PREBUILD_ARCH = currentArch;

  // Try setting compiler flags directly
  if (currentArch === "x64") {
    clDefines = "/D_M_X64 /D_WIN64 /D_AMD64_";
  } else if (currentArch === "arm64") {
    clDefines = "/D_M_ARM64 /D_WIN64";
  }

  if (clDefines) {
    env.CL = clDefines;
  }
}

// Build the prebuildify command with explicit architecture
const args = [
  "--napi",
  "--tag-libc",
  "--strip",
  "--arch",
  currentArch,
  "--platform",
  currentPlatform,
];

// Add any additional arguments passed to this script
if (process.argv.length > 2) {
  args.push(...process.argv.slice(2));
}

console.log(`Running: prebuildify ${args.join(" ")}`);
if (currentPlatform === "win32" && clDefines) {
  console.log(`CL environment variable: ${clDefines}`);
}

// Spawn prebuildify with the arguments
const child = spawn("prebuildify", args, {
  stdio: "inherit",
  shell: true,
  env,
});

child.on("error", (error) => {
  console.error("Failed to start prebuildify:", error);
  process.exit(1);
});

child.on("exit", (code) => {
  if (code !== 0) {
    console.error(`prebuildify exited with code ${code}`);
    process.exit(code || 1);
  }
});
