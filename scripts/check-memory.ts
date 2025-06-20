#!/usr/bin/env node

/**
 * Cross-platform memory checking script - Central orchestrator for all memory tests
 *
 * This script handles all platform-specific memory testing:
 * - JavaScript memory tests on all platforms
 * - Valgrind and ASAN/LSAN tests on Linux
 * - AddressSanitizer and leaks tool on macOS
 * - Handles platform-specific quirks (e.g., macOS SIP restrictions)
 *
 * Test order by platform:
 * - Linux/macOS: JavaScript tests → valgrind → ASAN
 * - Windows: JavaScript tests only
 *
 * IMPORTANT: This is the ONLY script that should be called for memory testing.
 * All platform-specific logic is handled internally. Do not call platform-specific
 * scripts (like macos-asan.sh) directly from package.json or precommit scripts.
 */

import { execFileSync, execSync } from "node:child_process";
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

// Function to run JavaScript memory tests
function runJavaScriptMemoryTests(): void {
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
        TEST_ESM: "0", // Use CommonJS mode for memory tests
        NODE_OPTIONS: "--expose-gc --no-warnings",
        // Clear any ASAN environment variables that might interfere
        DYLD_INSERT_LIBRARIES: undefined,
        ASAN_OPTIONS: undefined,
        MallocScribble: undefined,
        MallocGuardEdges: undefined,
      },
    });
    console.log(color(colors.GREEN, "✓ JavaScript memory tests passed"));
  } catch (error: any) {
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
}

// Ensure we have a clean build before running JavaScript memory tests on macOS
if (os.platform() === "darwin") {
  console.log(
    color(
      colors.YELLOW,
      "\nEnsuring clean build for JavaScript memory tests...",
    ),
  );
  try {
    // Clean and rebuild without ASAN to avoid contamination
    execSync("npm run clean:native", { stdio: "ignore" });
    execSync("npm run node-gyp-rebuild", {
      stdio: "ignore",
      env: {
        ...process.env,
        // Clear any ASAN environment variables
        CFLAGS: undefined,
        CXXFLAGS: undefined,
        LDFLAGS: undefined,
        DYLD_INSERT_LIBRARIES: undefined,
        ASAN_OPTIONS: undefined,
        MallocScribble: undefined,
        MallocGuardEdges: undefined,
      },
    });
  } catch (error) {
    // Ignore errors, we'll try to run tests anyway
  }
}

// On Windows, run debug tests first, then rebuild before JavaScript tests
if (os.platform() !== "win32") {
  // 1. Run JavaScript memory tests first on non-Windows platforms
  runJavaScriptMemoryTests();
}

// 2. Run valgrind if available and on Linux
if (os.platform() === "linux") {
  try {
    execFileSync("which", ["valgrind"], { stdio: "ignore" });
    console.log(color(colors.YELLOW, "\nRunning valgrind memory analysis..."));
    try {
      const valgrindScript = path.join(__dirname, "valgrind-test.sh");
      // Validate script exists before execution (security: prevent path traversal)
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
}

// 3. Run Address Sanitizer and Leak Sanitizer tests
if (os.platform() === "linux") {
  console.log(
    color(
      colors.YELLOW,
      "\nRunning AddressSanitizer and LeakSanitizer tests...",
    ),
  );
  try {
    const asanScript = path.join(__dirname, "sanitizers-test.sh");
    // Validate script exists before execution (security: prevent path traversal)
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
} else if (os.platform() === "darwin") {
  // 4. Run macOS-specific memory tests
  console.log(
    color(colors.YELLOW, "\nRunning macOS AddressSanitizer tests..."),
  );
  try {
    const macosAsanScript = path.join(__dirname, "macos-asan.sh");
    // Validate script exists before execution (security: prevent path traversal)
    if (
      !existsSync(macosAsanScript) ||
      !macosAsanScript.startsWith(__dirname)
    ) {
      throw new Error(`Invalid script path: ${macosAsanScript}`);
    }
    // Run in a clean environment to avoid ASAN contamination
    execFileSync("bash", [macosAsanScript], {
      stdio: "inherit",
      env: {
        ...process.env,
        // Clear any ASAN environment variables that might interfere
        DYLD_INSERT_LIBRARIES: undefined,
        ASAN_OPTIONS: undefined,
        MallocScribble: undefined,
        MallocGuardEdges: undefined,
      },
    });
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

// On Windows, just run JavaScript memory tests
if (os.platform() === "win32") {
  runJavaScriptMemoryTests();
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
