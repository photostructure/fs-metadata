#!/usr/bin/env tsx

/**
 * Standalone memory test runner for use in CI environments
 *
 * This script runs memory tests without Jest to avoid worker process issues
 * particularly on Windows CI. It uses the same test logic as the Jest tests
 * but with a simpler execution model.
 */

import { MemoryTestResult, runAllMemoryTests } from "./memory-test-core";

// ANSI color codes for output (disable on Windows for better compatibility)
const isWindows = process.platform === "win32";
const colors = {
  RED: isWindows ? "" : "\x1b[31m",
  GREEN: isWindows ? "" : "\x1b[32m",
  YELLOW: isWindows ? "" : "\x1b[33m",
  BLUE: isWindows ? "" : "\x1b[34m",
  RESET: isWindows ? "" : "\x1b[0m",
};

function formatMemory(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function printResult(result: MemoryTestResult): void {
  const statusSymbol = result.passed ? "✓" : "✗";
  const statusColor = result.passed ? colors.GREEN : colors.RED;

  console.log(
    `\n${statusColor}${statusSymbol} ${result.testName}${colors.RESET}`,
  );
  console.log(`  Initial memory: ${formatMemory(result.initialMemory)}`);
  console.log(`  Final memory: ${formatMemory(result.finalMemory)}`);
  console.log(`  Memory increase: ${formatMemory(result.memoryIncrease)}`);
  console.log(`  Memory slope: ${result.slope.toFixed(6)}`);

  if (result.errorMessage) {
    console.log(`  ${colors.RED}Error: ${result.errorMessage}${colors.RESET}`);
  }
}

async function main(): Promise<void> {
  console.log(
    `${colors.BLUE}=== Standalone Memory Test Runner ===${colors.RESET}`,
  );
  console.log(`Platform: ${process.platform}`);
  console.log(`Node version: ${process.version}`);
  console.log(`Process architecture: ${process.arch}`);

  // Check if garbage collection is exposed
  if (!global.gc) {
    console.error(
      `${colors.RED}Error: Garbage collection is not exposed.${colors.RESET}`,
    );
    console.error(
      "Please run with: NODE_OPTIONS='--expose-gc' tsx scripts/memory-test-runner.ts",
    );
    process.exit(1);
  }

  console.log("\nRunning memory tests...");

  try {
    const startTime = Date.now();
    const results = await runAllMemoryTests();
    const duration = Date.now() - startTime;

    // Print individual results
    for (const result of results) {
      printResult(result);
    }

    // Summary
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const total = results.length;

    console.log(`\n${colors.BLUE}=== Test Summary ===${colors.RESET}`);
    console.log(`Total tests: ${total}`);
    console.log(`${colors.GREEN}Passed: ${passed}${colors.RESET}`);
    if (failed > 0) {
      console.log(`${colors.RED}Failed: ${failed}${colors.RESET}`);
    }
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);

    if (failed > 0) {
      console.log(`\n${colors.RED}Memory tests failed!${colors.RESET}`);
      process.exit(1);
    } else {
      console.log(`\n${colors.GREEN}All memory tests passed!${colors.RESET}`);
      process.exit(0);
    }
  } catch (error) {
    console.error(
      `\n${colors.RED}Fatal error running memory tests:${colors.RESET}`,
    );
    console.error(error);
    process.exit(1);
  }
}

// Run the tests
main().catch((error) => {
  console.error(`${colors.RED}Unhandled error:${colors.RESET}`, error);
  process.exit(1);
});
