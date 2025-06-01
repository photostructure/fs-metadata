// src/memory.test.ts

import { jest } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { validateHidden } from "./test-utils/hidden-tests";
import { tmpDirNotHidden } from "./test-utils/platform";
import { fmtBytes, MiB } from "./units";

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
  jest.setTimeout(60_000);
  const iterations = 100;

  // Helper to get memory usage after GC
  async function getMemoryUsage(): Promise<number> {
    // Give things a bit to fall out of scope. delay(1) should be enough.
    await delay(100);
    global.gc();
    await delay(100);
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
    const memoryUsages = [1];

    // Run operations
    for (let iteration = 0; iteration < iterations; iteration++) {
      await operation();
      if (iteration % Math.floor(iterations / 10) === 0) {
        const currentMemory = await getMemoryUsage();
        memoryUsages.push(currentMemory / initialMemory);
        // console.dir({
        //   iteration,
        //   currentMemory: fmtBytes(currentMemory),
        //   diff: fmtBytes(currentMemory - initialMemory),
        //   slope: slope(memoryUsages),
        // });
      }
    }

    // Final memory check
    const finalMemory = await getMemoryUsage();
    memoryUsages.push(finalMemory / initialMemory);
    const slope = leastSquaresSlope(memoryUsages);
    console.dir({
      initial: fmtBytes(initialMemory),
      final: fmtBytes(finalMemory),
      diff: fmtBytes(finalMemory - initialMemory),
      slope,
    });
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
    it("should not leak memory under repeated calls", async () => {
      await checkMemoryUsage(async () => {
        const dir = await mkdtemp(join(tmpDirNotHidden(), "memory-tests-"));
        try {
          await validateHidden(dir);
        } finally {
          await rm(dir, { recursive: true, maxRetries: 3 }).catch(() => null);
        }
      });
    });

    it("should not leak memory under error conditions", async () => {
      await checkMemoryUsage(async () => {
        const notafile = join(
          tmpdir(),
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
