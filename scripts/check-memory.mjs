#!/usr/bin/env node

/**
 * Cross-platform memory checking script
 * Runs JavaScript memory tests on all platforms
 * Runs valgrind and ASAN tests only on Linux
 */

import { execFileSync, execSync } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for output
const colors = {
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  RESET: "\x1b[0m",
};

// Use colors only if not on Windows
const isWindows = os.platform() === "win32";
const color = (colorCode, text) =>
  isWindows ? text : `${colorCode}${text}${colors.RESET}`;

console.log(color(colors.BLUE, "=== Memory Leak Detection Suite ==="));

let exitCode = 0;

// 1. Run JavaScript memory tests (all platforms)
console.log(color(colors.YELLOW, "\nRunning JavaScript memory tests..."));
try {
  // Use node to execute jest.js for cross-platform compatibility
  const jestPath = path.join("node_modules", "jest", "bin", "jest.js");
  const nodeExe = process.execPath;
  const args = [jestPath, "--no-coverage", "src/memory.test.ts"];

  // Debug output
  console.log("Debug: Node executable:", nodeExe);
  console.log("Debug: Jest path:", jestPath);
  console.log("Debug: Full command:", nodeExe, args.join(" "));
  console.log("Debug: Current directory:", process.cwd());
  console.log("Debug: Platform:", os.platform());
  console.log("Debug: Node version:", process.version);

  execFileSync(nodeExe, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      TEST_MEMORY: "1",
      TEST_ESM: "1",
      NODE_OPTIONS: "--expose-gc --experimental-vm-modules --no-warnings",
    },
  });
  console.log(color(colors.GREEN, "✓ JavaScript memory tests passed"));
} catch (error) {
  console.log(color(colors.RED, "✗ JavaScript memory tests failed"));
  console.error("Debug: Error details:", error.message);
  if (error.code) {
    console.error("Debug: Error code:", error.code);
  }
  if (error.signal) {
    console.error("Debug: Error signal:", error.signal);
  }
  exitCode = 1;
}

// 2. Run valgrind if available and on Linux
if (os.platform() === "linux") {
  try {
    execFileSync("which", ["valgrind"], { stdio: "ignore" });
    console.log(color(colors.YELLOW, "\nRunning valgrind memory analysis..."));
    try {
      const valgrindScript = path.join(__dirname, "valgrind-test.sh");
      execSync(valgrindScript, { stdio: "inherit" });
      console.log(color(colors.GREEN, "✓ Valgrind tests passed"));
    } catch {
      console.log(color(colors.RED, "✗ Valgrind tests failed"));
      exitCode = 1;
    }
  } catch {
    console.log(color(colors.YELLOW, "\nValgrind not available. Skipping."));
  }
}

// 3. Run Address Sanitizer and Leak Sanitizer if requested (Linux only)
if (os.platform() === "linux") {
  console.log(
    color(
      colors.YELLOW,
      "\nRunning AddressSanitizer and LeakSanitizer tests...",
    ),
  );
  try {
    const asanScript = path.join(__dirname, "sanitizers-test.sh");
    execSync(asanScript, { stdio: "inherit" });
    console.log(
      color(colors.GREEN, "✓ AddressSanitizer and LeakSanitizer tests passed"),
    );
  } catch {
    console.log(
      color(colors.RED, "✗ AddressSanitizer or LeakSanitizer tests failed"),
    );
    exitCode = 1;
  }
}

if (exitCode === 0) {
  console.log(
    color(colors.GREEN, "\n=== All memory tests completed successfully! ==="),
  );
} else {
  console.log(
    color(colors.RED, "\n=== Memory tests failed! See output above. ==="),
  );
}

process.exit(exitCode);
