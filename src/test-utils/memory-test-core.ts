import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { env, platform } from "node:process";
import { delay } from "../async";
import {
  getAllVolumeMetadata,
  getVolumeMetadata,
  getVolumeMountPoints,
  isHidden,
  setHidden,
} from "../index";
import { randomLetters } from "../random";
import { MiB } from "../units";
import { runAdaptiveBenchmarkWithCallback } from "./benchmark-harness";
import { getTimingMultiplier } from "./test-timeout-config";

// Core memory testing logic for the standalone memory test runner
// This module contains all memory leak detection tests, designed to run
// outside of Jest for more accurate memory measurements and to avoid
// Jest worker process issues on Windows CI.

// Simple assertion helper
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// Enable garbage collection access
declare const global: {
  gc?: () => void;
} & typeof globalThis;

// Helper function to get a temporary directory that's not hidden
function tmpDirNotHidden(): string {
  const isMacOS = platform === "darwin";
  const isWindows = platform === "win32";

  const dir = isMacOS
    ? join(homedir(), "tmp")
    : isWindows
      ? join(env["SystemDrive"] ?? "C:\\", "tmp")
      : "/tmp";

  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface MemoryTestResult {
  testName: string;
  passed: boolean;
  initialMemory: number;
  finalMemory: number;
  memoryIncrease: number;
  slope: number;
  errorMessage?: string;
}

// Helper to get memory usage after GC
async function getMemoryUsage(): Promise<number> {
  // Give things a bit to fall out of scope
  // Use dynamic delay based on environment
  const delayMs = Math.max(10, 100 * getTimingMultiplier());
  await delay(delayMs);
  if (global.gc) {
    global.gc();
  }
  await delay(delayMs);
  return process.memoryUsage().heapUsed;
}

/**
 * Detects the likelihood of a memory leak based on memory usage values.
 * @param memoryUsages - Array of memory usage values.
 * @returns A boolean indicating if a memory leak is likely.
 */
function leastSquaresSlope(memoryUsages: number[]): number {
  const n = memoryUsages.length;
  if (n < 2) return 0;

  // Calculate the slope using linear regression (least squares method)
  const xSum = (n * (n - 1)) / 2;
  const ySum = memoryUsages.reduce((sum, usage) => sum + usage, 0);
  const xySum = memoryUsages.reduce((sum, usage, i) => sum + i * usage, 0);
  const xSquaredSum = (n * (n - 1) * (2 * n - 1)) / 6;

  const result = (n * xySum - xSum * ySum) / (n * xSquaredSum - xSum * xSum);

  // If the slope is positive and significant, it indicates a memory leak
  return result;
}

// Helper to check if memory usage is stable
async function checkMemoryUsage(
  operation: () => Promise<unknown>,
  errorMarginBytes: number = 10 * MiB, // Alpine docker had a 5MB variance
  maxAllowedSlope: number = 0.01,
): Promise<{
  passed: boolean;
  initialMemory: number;
  finalMemory: number;
  slope: number;
  errorMessage?: string;
}> {
  // warm up memory consumption:
  for (let i = 0; i < 5; i++) await operation();

  // __then__ take a snapshot
  const initialMemory = await getMemoryUsage();
  const memoryUsages: number[] = [1];

  // Run operations using adaptive benchmark
  await runAdaptiveBenchmarkWithCallback(
    operation,
    async (_result, iteration) => {
      // Take memory snapshots approximately 10 times during the benchmark
      // Check every 10 iterations initially, will adjust based on actual runtime
      if (iteration === 0 || iteration % 10 === 0) {
        const currentMemory = await getMemoryUsage();
        memoryUsages.push(currentMemory / initialMemory);
      }
    },
    {
      targetDurationMs: 10_000, // Reduced from 20s to 10s for faster CI
      maxTimeoutMs: 30_000, // Reduced from 60s to 30s
      minIterations: 10,
      debug: !!process.env["DEBUG_BENCHMARK"],
    },
  );

  // Final memory check
  const finalMemory = await getMemoryUsage();
  memoryUsages.push(finalMemory / initialMemory);
  const slope = leastSquaresSlope(memoryUsages);

  const memoryIncrease = finalMemory - initialMemory;
  let errorMessage: string | undefined;

  if (memoryIncrease >= errorMarginBytes) {
    errorMessage = `Memory increased by ${(memoryIncrease / MiB).toFixed(2)} MiB, exceeding limit of ${(errorMarginBytes / MiB).toFixed(2)} MiB`;
  } else if (slope >= maxAllowedSlope) {
    errorMessage = `Memory slope ${slope.toFixed(4)} exceeds limit of ${maxAllowedSlope}`;
  }

  return {
    passed: !errorMessage,
    initialMemory,
    finalMemory,
    slope,
    ...(errorMessage && { errorMessage }),
  };
}

// Memory test implementations
export async function testVolumeMountPointsNoLeak(): Promise<MemoryTestResult> {
  const result = await checkMemoryUsage(async () => {
    const mountPoints = await getVolumeMountPoints();
    if (mountPoints.length === 0) {
      throw new Error("Expected at least one mount point");
    }
  });

  return {
    testName: "getVolumeMountPoints - no memory leak",
    passed: result.passed,
    initialMemory: result.initialMemory,
    finalMemory: result.finalMemory,
    memoryIncrease: result.finalMemory - result.initialMemory,
    slope: result.slope,
    ...(result.errorMessage && { errorMessage: result.errorMessage }),
  };
}

export async function testVolumeMountPointsErrorConditions(): Promise<MemoryTestResult> {
  const result = await checkMemoryUsage(async () => {
    try {
      await getVolumeMountPoints({ timeoutMs: 1 });
    } catch {
      // Expected
    }
  });

  return {
    testName: "getVolumeMountPoints - error conditions",
    passed: result.passed,
    initialMemory: result.initialMemory,
    finalMemory: result.finalMemory,
    memoryIncrease: result.finalMemory - result.initialMemory,
    slope: result.slope,
    ...(result.errorMessage && { errorMessage: result.errorMessage }),
  };
}

export async function testGetAllVolumeMetadataNoLeak(): Promise<MemoryTestResult> {
  const result = await checkMemoryUsage(async () => {
    const metadata = await getAllVolumeMetadata();
    if (metadata.length === 0) {
      throw new Error("Expected at least one volume");
    }
  });

  return {
    testName: "getAllVolumeMetadata - no memory leak",
    passed: result.passed,
    initialMemory: result.initialMemory,
    finalMemory: result.finalMemory,
    memoryIncrease: result.finalMemory - result.initialMemory,
    slope: result.slope,
    ...(result.errorMessage && { errorMessage: result.errorMessage }),
  };
}

export async function testGetVolumeMetadataErrorConditions(): Promise<MemoryTestResult> {
  const result = await checkMemoryUsage(async () => {
    try {
      await getVolumeMetadata("nonexistent");
    } catch {
      // Expected
    }
  });

  return {
    testName: "getVolumeMetadata - error conditions",
    passed: result.passed,
    initialMemory: result.initialMemory,
    finalMemory: result.finalMemory,
    memoryIncrease: result.finalMemory - result.initialMemory,
    slope: result.slope,
    ...(result.errorMessage && { errorMessage: result.errorMessage }),
  };
}

export async function testIsHiddenSetHiddenNoLeak(): Promise<MemoryTestResult> {
  const testDir = await mkdtemp(join(tmpDirNotHidden(), "memory-tests-"));
  let counter = 0;

  try {
    const result = await checkMemoryUsage(async () => {
      // Create a unique subdirectory for each iteration to avoid path conflicts
      const iterationDir = join(testDir, `iteration-${counter++}`);

      // Simple validateHidden implementation without Jest dependencies
      mkdirSync(iterationDir, { recursive: true });

      // Test isHidden on a regular directory (should be false)
      const isHiddenResult = await isHidden(iterationDir);
      assert(
        isHiddenResult === false,
        `Expected ${iterationDir} to not be hidden`,
      );

      // Test setHidden to true
      // On Linux, setHidden renames the file/dir by adding a dot prefix,
      // so we need to capture the returned pathname
      const hiddenPath = (await setHidden(iterationDir, true)).pathname;
      const isHiddenAfterSet = await isHidden(hiddenPath);
      assert(
        isHiddenAfterSet === true,
        `Expected ${hiddenPath} to be hidden after setHidden(true)`,
      );

      // Test setHidden to false
      const visiblePath = (await setHidden(hiddenPath, false)).pathname;
      const isHiddenAfterUnset = await isHidden(visiblePath);
      assert(
        isHiddenAfterUnset === false,
        `Expected ${visiblePath} to not be hidden after setHidden(false)`,
      );
    });

    return {
      testName: "isHidden/setHidden - no memory leak",
      passed: result.passed,
      initialMemory: result.initialMemory,
      finalMemory: result.finalMemory,
      memoryIncrease: result.finalMemory - result.initialMemory,
      slope: result.slope,
      ...(result.errorMessage && { errorMessage: result.errorMessage }),
    };
  } finally {
    await rm(testDir, { recursive: true, force: true }).catch(() => null);
  }
}

export async function testIsHiddenSetHiddenErrorConditions(): Promise<MemoryTestResult> {
  const testDir = await mkdtemp(join(tmpDirNotHidden(), "memory-tests-"));

  try {
    const result = await checkMemoryUsage(async () => {
      const notafile = join(testDir, "nonexistent", "file-" + randomLetters(8));
      try {
        await isHidden(notafile);
      } catch {
        // Expected
      }
      try {
        await setHidden(notafile, true);
      } catch {
        // Expected
      }
    });

    return {
      testName: "isHidden/setHidden - error conditions",
      passed: result.passed,
      initialMemory: result.initialMemory,
      finalMemory: result.finalMemory,
      memoryIncrease: result.finalMemory - result.initialMemory,
      slope: result.slope,
      ...(result.errorMessage && { errorMessage: result.errorMessage }),
    };
  } finally {
    await rm(testDir, { recursive: true, force: true }).catch(() => null);
  }
}

// Run all memory tests
export async function runAllMemoryTests(): Promise<MemoryTestResult[]> {
  if (!global.gc) {
    throw new Error("Garbage collection must be exposed. Run with --expose-gc");
  }

  const results: MemoryTestResult[] = [];

  // Run each test and collect results
  results.push(await testVolumeMountPointsNoLeak());
  results.push(await testVolumeMountPointsErrorConditions());
  results.push(await testGetAllVolumeMetadataNoLeak());
  results.push(await testGetVolumeMetadataErrorConditions());
  results.push(await testIsHiddenSetHiddenNoLeak());
  results.push(await testIsHiddenSetHiddenErrorConditions());

  return results;
}
