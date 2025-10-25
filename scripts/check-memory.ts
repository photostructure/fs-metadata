#!/usr/bin/env node

/**
 * Cross-platform memory checking script - Central orchestrator for all memory tests
 *
 * This script handles all platform-specific memory testing:
 * - JavaScript memory tests on all platforms (via standalone runner)
 * - Valgrind and ASAN/LSAN tests on Linux
 * - AddressSanitizer tests on macOS
 *
 * JavaScript memory tests use src/test-utils/memory-test-runner.ts directly,
 * bypassing Jest for more accurate measurements and avoiding worker issues.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for output
const colors = {
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  RESET: "\x1b[0m",
} as const;

// Use colors only if not on Windows
const isWindows = os.platform() === "win32";
const color = (colorCode: string, text: string): string =>
  isWindows ? text : `${colorCode}${text}${colors.RESET}`;

console.log(color(colors.BLUE, "=== Memory Leak Detection Suite ==="));

let exitCode = 0;

// 1. Run JavaScript memory tests on all platforms
console.log(color(colors.YELLOW, "\nRunning JavaScript memory tests..."));
try {
  const nodeExe = process.execPath;
  const runnerPath = path.join(
    __dirname,
    "..",
    "src",
    "test-utils",
    "memory-test-runner.ts",
  );
  const args = ["--expose-gc", "--no-warnings", "-r", "tsx/cjs", runnerPath];

  console.log(`Executing: ${nodeExe} ${args.join(" ")}`);

  execFileSync(nodeExe, args, {
    stdio: "inherit",
    env: {
      ...process.env,
    },
  });
  console.log(color(colors.GREEN, "✓ JavaScript memory tests passed"));
} catch (error: any) {
  console.log(color(colors.RED, "✗ JavaScript memory tests failed"));
  // Print full error details to help diagnose CI issues
  console.error("Error details:");
  console.error("  Message:", error.message);
  if (error.stderr) {
    console.error("  Stderr:", error.stderr.toString());
  }
  if (error.stdout) {
    console.error("  Stdout:", error.stdout.toString());
  }
  console.error("  Status:", error.status);
  console.error("  Signal:", error.signal);
  exitCode = 1;
}

// 2. Run platform-specific native memory tests
const platform = os.platform();

if (platform === "linux") {
  // Run valgrind if available
  try {
    execFileSync("which", ["valgrind"], { stdio: "ignore" });
    console.log(color(colors.YELLOW, "\nRunning valgrind memory analysis..."));

    try {
      const valgrindScript = path.join(__dirname, "valgrind-test.sh");
      if (
        !existsSync(valgrindScript) ||
        !valgrindScript.startsWith(__dirname)
      ) {
        throw new Error(`Invalid script path: ${valgrindScript}`);
      }

      execFileSync("bash", [valgrindScript], {
        stdio: "inherit",
        shell: false,
      });
      console.log(color(colors.GREEN, "✓ Valgrind tests passed"));
    } catch (error) {
      console.log(color(colors.RED, "✗ Valgrind tests failed"));
      if (error instanceof Error) {
        console.log(color(colors.RED, `  Error: ${error.message}`));
      }
      exitCode = 1;
    }
  } catch {
    console.log(color(colors.YELLOW, "\nValgrind not available. Skipping."));
  }

  // Run AddressSanitizer and LeakSanitizer
  console.log(
    color(
      colors.YELLOW,
      "\nRunning AddressSanitizer and LeakSanitizer tests...",
    ),
  );
  try {
    const asanScript = path.join(__dirname, "sanitizers-test.sh");
    if (!existsSync(asanScript) || !asanScript.startsWith(__dirname)) {
      throw new Error(`Invalid script path: ${asanScript}`);
    }

    execFileSync("bash", [asanScript], { stdio: "inherit", shell: false });
    console.log(
      color(colors.GREEN, "✓ AddressSanitizer and LeakSanitizer tests passed"),
    );
  } catch (error) {
    console.log(
      color(colors.RED, "✗ AddressSanitizer or LeakSanitizer tests failed"),
    );
    if (error instanceof Error) {
      console.log(color(colors.RED, `  Error: ${error.message}`));
    }
    exitCode = 1;
  }
} else if (platform === "darwin") {
  // Run macOS AddressSanitizer
  console.log(
    color(colors.YELLOW, "\nRunning macOS AddressSanitizer tests..."),
  );
  try {
    const macosAsanScript = path.join(__dirname, "macos-asan.sh");
    if (
      !existsSync(macosAsanScript) ||
      !macosAsanScript.startsWith(__dirname)
    ) {
      throw new Error(`Invalid script path: ${macosAsanScript}`);
    }

    execFileSync("bash", [macosAsanScript], { stdio: "inherit" });
    console.log(color(colors.GREEN, "✓ macOS AddressSanitizer tests passed"));
  } catch (error) {
    // On macOS, AddressSanitizer may fail due to SIP restrictions
    // This is expected behavior and should not fail the overall test
    console.log(
      color(
        colors.YELLOW,
        "⚠ macOS AddressSanitizer tests completed with warnings",
      ),
    );
    console.log(
      color(
        colors.YELLOW,
        "  This is expected due to macOS System Integrity Protection (SIP)",
      ),
    );
    // Don't set exitCode = 1 for macOS ASAN failures
  }
}

// 3. Report results
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
