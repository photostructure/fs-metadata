// src/memory.test.ts

import { jest } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { delay } from "./async";
import {
  getAllVolumeMetadata,
  getVolumeMetadata,
  getVolumeMountPoints,
  isHidden,
  setHidden,
} from "./index";
import { randomLetters } from "./random";
import { runAdaptiveBenchmarkWithCallback } from "./test-utils/benchmark-harness";
import { validateHidden } from "./test-utils/hidden-tests";
import { tmpDirNotHidden } from "./test-utils/platform";
import {
  getTestTimeout,
  getTimingMultiplier,
} from "./test-utils/test-timeout-config";
import { MiB } from "./units";

// THIS IS ALL A HORRIBLE HACK. THIS "test" SHOULD BE REPLACED WITH AN ACTUAL
// MEMORY LEAK TESTER (like with valgrind). PULL REQUESTS ARE WELCOME.

// Enable garbage collection access
declare const global: {
  gc: () => void;
} & typeof globalThis;

// Skip all tests unless TEST_MEMORY env var is set
const shouldRunMemoryTests = !!process.env["TEST_MEMORY"];
const describeMemory = shouldRunMemoryTests ? describe : describe.skip;

describeMemory("Memory Tests", () => {
  jest.setTimeout(getTestTimeout(60_000)); // Base 60s timeout for memory-intensive tests

  // Helper to get memory usage after GC
  async function getMemoryUsage(): Promise<number> {
    // Give things a bit to fall out of scope
    // Use dynamic delay based on environment
    const delayMs = Math.max(10, 100 * getTimingMultiplier());
    await delay(delayMs);
    global.gc();
    await delay(delayMs);
    return process.memoryUsage().heapUsed;
  }

  // Helper to check if memory usage is stable
  async function checkMemoryUsage(
    operation: () => Promise<unknown>,
    errorMarginBytes: number = 10 * MiB, // Alpine docker had a 5MB variance
    maxAllowedSlope: number = 0.01,
  ) {
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
        targetDurationMs: 20_000,
        maxTimeoutMs: 60_000,
        minIterations: 10,
        debug: !!process.env["DEBUG_BENCHMARK"],
      },
    );

    // Final memory check
    const finalMemory = await getMemoryUsage();
    memoryUsages.push(finalMemory / initialMemory);
    const slope = leastSquaresSlope(memoryUsages);
    expect(finalMemory - initialMemory).toBeLessThan(errorMarginBytes);
    expect(slope).toBeLessThan(maxAllowedSlope);
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

  describe("getVolumeMountPoints", () => {
    it("should not leak memory under repeated calls", async () => {
      await checkMemoryUsage(async () => {
        const mountPoints = await getVolumeMountPoints();
        expect(mountPoints.length).toBeGreaterThan(0);
      });
    });

    it("should not leak memory under error conditions", async () => {
      await checkMemoryUsage(async () => {
        try {
          await getVolumeMountPoints({ timeoutMs: 1 });
        } catch {
          // Expected
        }
      });
    });
  });

  describe("getAllVolumeMetadata", () => {
    it("should not leak memory under repeated calls", async () => {
      await checkMemoryUsage(async () => {
        const metadata = await getAllVolumeMetadata();
        expect(metadata.length).toBeGreaterThan(0);
      });
    });

    it("should not leak memory under error conditions", async () => {
      await checkMemoryUsage(async () => {
        try {
          await getVolumeMetadata("nonexistent");
        } catch {
          // Expected
        }
      });
    });
  });
  describe("isHidden/setHidden", () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpDirNotHidden(), "memory-tests-"));
    });

    afterEach(async () => {
      if (testDir) {
        await rm(testDir, { recursive: true, force: true }).catch(() => null);
      }
    });

    it("should not leak memory under repeated calls", async () => {
      let counter = 0;
      await checkMemoryUsage(async () => {
        // Create a unique subdirectory for each iteration to avoid path conflicts
        const iterationDir = join(testDir, `iteration-${counter++}`);
        await validateHidden(iterationDir);
      });
    });

    it("should not leak memory under error conditions", async () => {
      await checkMemoryUsage(async () => {
        const notafile = join(
          testDir,
          "nonexistent",
          "file-" + randomLetters(8),
        );
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
    });
  });
});
