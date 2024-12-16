// src/memory.test.ts

import { jest } from "@jest/globals";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { delay } from "./async.js";
import {
  getAllVolumeMetadata,
  getVolumeMetadata,
  getVolumeMountPoints,
  isHidden,
  setHidden,
} from "./index.js";
import { isMacOS } from "./platform.js";
import { randomLetters } from "./random.js";
import { validateHidden } from "./test-utils/hidden-tests.js";
import { tmpDirNotHidden } from "./test-utils/platform.js";
import { MiB } from "./units.js";

// Enable garbage collection access
declare const global: {
  gc: () => void;
} & typeof globalThis;

// Skip all tests unless TEST_MEMORY env var is set
const shouldRunMemoryTests = !!process.env["TEST_MEMORY"];
const describeMemory = shouldRunMemoryTests ? describe : describe.skip;

describeMemory("Memory Tests", () => {
  jest.setTimeout(60_000);
  const iterations = 200;

  // Helper to get memory usage after GC
  function getMemoryUsage(): number {
    global.gc();
    return process.memoryUsage().heapUsed;
  }

  // Helper to check if memory usage is stable
  async function checkMemoryUsage(
    operation: () => Promise<unknown>,
    errorMarginBytes: number = (isMacOS ? 7 : 5) * MiB,
  ) {
    const initialMemory = getMemoryUsage();

    // Run operations
    for (let i = 0; i < iterations; i++) {
      await operation();

      // Check every 10 iterations
      if (i % Math.floor(iterations / 5) === 0) {
        await delay(1); // < Allow GC to settle
        const currentMemory = getMemoryUsage();
        console.log(`Memory after iteration ${i}: ${currentMemory} bytes`);
        // Allow some variance but fail on large increases
        expect(currentMemory - initialMemory).toBeLessThan(errorMarginBytes);
      }
    }

    // Final memory check
    const finalMemory = getMemoryUsage();
    console.log(`Initial memory: ${initialMemory} bytes`);
    console.log(`Final memory: ${finalMemory} bytes`);
    console.log(`Difference: ${finalMemory - initialMemory} bytes`);

    expect(finalMemory - initialMemory).toBeLessThan(errorMarginBytes);
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
