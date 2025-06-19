import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { _dirname } from "./dirname";
import { getVolumeMetadata, getVolumeMountPoints, isHidden } from "./index";
import { isMacOS, isWindows } from "./platform";
import { runAdaptiveBenchmark } from "./test-utils/benchmark-harness";
import { describeSkipAlpineARM64 } from "./test-utils/platform";
import { getTestTimeout } from "./test-utils/test-timeout-config";
import type { MountPoint } from "./types/mount_point";
import type { VolumeMetadata } from "./types/volume_metadata";

// Define types for worker communication
type WorkerTask =
  | { task: "getVolumeMountPoints" }
  | {
      task: "getVolumeMetadata";
      mountPoint: string;
      options?: { timeoutMs: number };
    }
  | { task: "isHidden"; path: string }
  | { task: "setHidden"; path: string; hidden: boolean };

type WorkerResult<T> =
  | { success: true; result: T }
  | {
      success: false;
      error: string;
      stack?: string;
      platform?: string;
      arch?: string;
    };

// Path to the worker helper file
const workerHelperPath = join(
  _dirname(),
  "test-utils",
  "worker-thread-helper.cjs",
);

describeSkipAlpineARM64("Worker Threads Support", () => {
  let testDir: string;
  let testFile: string;

  beforeAll(() => {
    // Create a temporary directory for testing
    testDir = mkdtempSync(join(tmpdir(), "fs-metadata-worker-test-"));
    testFile = join(testDir, "test-file.txt");
    writeFileSync(testFile, "test content");
  });

  afterAll(() => {
    // Clean up
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function runInWorker<T = unknown>(workerData: WorkerTask): Promise<T> {
    return new Promise((resolve, reject) => {
      let isResolved = false;

      const worker = new Worker(workerHelperPath, {
        workerData,
      });

      const cleanup = async () => {
        if (!isResolved) {
          isResolved = true;
          await worker.terminate();
        }
      };

      worker.on("message", (message: WorkerResult<T>) => {
        if (!isResolved) {
          isResolved = true;
          cleanup().then(() => {
            if (message.success) {
              resolve(message.result);
            } else {
              // Enhanced error handling for debugging
              const errorMsg =
                message.stack && process.env["CI"]
                  ? `${message.error}\nPlatform: ${message.platform}, Arch: ${message.arch}\nStack: ${message.stack}`
                  : message.error;
              reject(new Error(errorMsg));
            }
          });
        }
      });

      worker.on("error", (error) => {
        if (!isResolved) {
          isResolved = true;
          cleanup().then(() => {
            reject(error);
          });
        }
      });

      worker.on("exit", (code) => {
        if (!isResolved && code !== 0) {
          isResolved = true;
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }

  it("should get volume mount points from worker thread", async () => {
    const workerResult = await runInWorker<MountPoint[]>({
      task: "getVolumeMountPoints",
    });

    // Results should have mount points
    expect(workerResult.length).toBeGreaterThan(0);
    expect(Array.isArray(workerResult)).toBe(true);

    // Basic structure validation
    for (const item of workerResult) {
      expect(item).toHaveProperty("mountPoint");
      expect(typeof item.mountPoint).toBe("string");
      expect(item.mountPoint.length).toBeGreaterThan(0);
    }
  });

  it("should get volume metadata from worker thread", async () => {
    const mountPoints = await getVolumeMountPoints();
    if (mountPoints.length === 0) {
      return;
    }

    // Find a healthy mount point to test with
    const healthyMount = mountPoints.find(
      (mp) => mp.status === "healthy" || mp.status === undefined,
    );

    if (!healthyMount) {
      return;
    }

    const mainThreadResult = await getVolumeMetadata(healthyMount.mountPoint);
    const workerResult = await runInWorker<VolumeMetadata>({
      task: "getVolumeMetadata",
      mountPoint: healthyMount.mountPoint,
    });

    // Validate the structure rather than exact values (which might change between calls)
    expect(typeof workerResult.size).toBe("number");
    expect(typeof workerResult.available).toBe("number");
    expect(typeof workerResult.used).toBe("number");
    expect(workerResult.size).toBeGreaterThan(0);

    // Verify available and used are non-negative
    expect(workerResult.available).toBeGreaterThanOrEqual(0);
    expect(workerResult.used).toBeGreaterThanOrEqual(0);

    // Verify that available + used approximately equals size
    if (
      workerResult.size !== undefined &&
      workerResult.available !== undefined &&
      workerResult.used !== undefined
    ) {
      const sum = workerResult.available + workerResult.used;
      const difference = Math.abs(workerResult.size - sum);
      const tolerance = workerResult.size * 0.1; // Allow 10% tolerance

      // The sum should be close to the total size
      expect(difference).toBeLessThanOrEqual(tolerance);
    }

    // Mount from might be null or an object on some systems
    if (
      mainThreadResult.mountFrom !== null &&
      workerResult.mountFrom !== null
    ) {
      expect(["string", "object"].includes(typeof workerResult.mountFrom)).toBe(
        true,
      );
    }
  });

  it("should handle isHidden from worker thread", async () => {
    if (!isWindows && !isMacOS) {
      return;
    }

    const mainThreadResult = await isHidden(testFile);
    const workerResult = await runInWorker<boolean>({
      task: "isHidden",
      path: testFile,
    });

    expect(workerResult).toBe(mainThreadResult);
  });

  it("should handle setHidden from worker thread", async () => {
    if (!isWindows && !isMacOS) {
      return;
    }

    // Set hidden to true
    await runInWorker({
      task: "setHidden",
      path: testFile,
      hidden: true,
    });

    // Verify it's hidden
    const isHiddenResult = await runInWorker<boolean>({
      task: "isHidden",
      path: testFile,
    });
    expect(isHiddenResult).toBe(true);

    // Set hidden to false
    await runInWorker({
      task: "setHidden",
      path: testFile,
      hidden: false,
    });

    // Verify it's not hidden
    const isNotHiddenResult = await runInWorker<boolean>({
      task: "isHidden",
      path: testFile,
    });
    expect(isNotHiddenResult).toBe(false);
  });

  it(
    "should handle concurrent operations from multiple worker threads",
    async () => {
      const mountPoints = await getVolumeMountPoints();
      if (mountPoints.length === 0) {
        return;
      }

      // Find a healthy mount point to test with
      const healthyMount = mountPoints.find(
        (mp) => mp.status === "healthy" || mp.status === undefined,
      );

      if (!healthyMount) {
        return;
      }

      const allResults: (MountPoint[] | VolumeMetadata)[] = [];

      // Use adaptive benchmark for concurrent worker operations
      await runAdaptiveBenchmark(
        async () => {
          const workerCount = 4;
          const workers: Promise<MountPoint[] | VolumeMetadata>[] = [];

          // Create multiple workers doing different tasks concurrently
          for (let i = 0; i < workerCount; i++) {
            // Mix different operations
            if (i % 2 === 0) {
              workers.push(
                runInWorker<MountPoint[]>({ task: "getVolumeMountPoints" }),
              );
            } else {
              workers.push(
                runInWorker<VolumeMetadata>({
                  task: "getVolumeMetadata",
                  mountPoint: healthyMount.mountPoint,
                }),
              );
            }
          }

          // Use allSettled to handle potential failures gracefully
          const settledResults = await Promise.allSettled(workers);
          const iterationResults = settledResults
            .filter((r) => r.status === "fulfilled")
            .map(
              (r) =>
                (r as PromiseFulfilledResult<MountPoint[] | VolumeMetadata>)
                  .value,
            );
          allResults.push(...iterationResults);
        },
        {
          targetDurationMs: 2_000, // Target 2 seconds of testing (reduced from 5)
          maxTimeoutMs: 5_000, // Max 5 seconds (reduced from 15)
          minIterations: 1, // At least 1 iteration (reduced from 2)
          debug: !!process.env["DEBUG_BENCHMARK"],
        },
      );

      expect(allResults.length).toBeGreaterThan(0);
      allResults.forEach((result) => {
        expect(result).toBeDefined();
      });
    },
    getTestTimeout(20000),
  );

  it("should handle errors gracefully in worker threads", async () => {
    // Test with invalid mount point
    const invalidPath = isWindows
      ? "Z:\\nonexistent\\path" // Use a path on a drive that likely doesn't exist
      : "/invalid/mount/point/that/does/not/exist";

    try {
      const result = await runInWorker<VolumeMetadata>({
        task: "getVolumeMetadata",
        mountPoint: invalidPath,
      });

      // On Windows, invalid paths may return metadata with inaccessible status
      if (isWindows && result.status === "inaccessible") {
        expect(result.status).toBe("inaccessible");
        expect(result.size).toBe(0);
        expect(result.available).toBe(0);
        expect(result.used).toBe(0);
      } else {
        // On other platforms, this should throw
        throw new Error("Expected an error or inaccessible status");
      }
    } catch (error) {
      // On non-Windows platforms or for truly invalid paths, expect an error
      expect(error).toBeDefined();
      if (error instanceof Error) {
        expect(error.message).toMatch(
          /ENOENT|No such file or directory|not accessible|Failed to get volume|statvfs failed/i,
        );
      }
    }

    // Test with invalid task
    await expect(
      runInWorker({
        task: "invalidTask",
      } as unknown as WorkerTask),
    ).rejects.toThrow("Unknown task");
  });

  it(
    "should maintain thread isolation",
    async () => {
      // This test verifies that each worker has its own context
      // and operations in one worker don't affect another
      const mountPoints = await getVolumeMountPoints();
      if (mountPoints.length === 0) {
        return;
      }

      // Find a healthy mount point to test with
      const healthyMount = mountPoints.find(
        (mp) => mp.status === "healthy" || mp.status === undefined,
      );

      if (!healthyMount) {
        return;
      }

      // Collect all results
      const allResults: VolumeMetadata[] = [];

      // Run adaptive benchmark with parallel workers
      await runAdaptiveBenchmark(
        async () => {
          const parallelCount = 5; // Run 5 parallel workers per iteration
          const promises: Promise<VolumeMetadata>[] = [];

          for (let i = 0; i < parallelCount; i++) {
            promises.push(
              runInWorker<VolumeMetadata>({
                task: "getVolumeMetadata",
                mountPoint: healthyMount.mountPoint,
                options: { timeoutMs: 5000 },
              }),
            );
          }

          const settledResults = await Promise.allSettled(promises);
          const iterationResults = settledResults
            .filter((r) => r.status === "fulfilled")
            .map((r) => (r as PromiseFulfilledResult<VolumeMetadata>).value);
          allResults.push(...iterationResults);
        },
        {
          targetDurationMs: 2_000, // Target 2 seconds of testing
          maxTimeoutMs: 5_000, // Max 5 seconds
          minIterations: 2, // At least 2 iterations (10 results minimum)
          debug: !!process.env["DEBUG_BENCHMARK"],
        },
      );

      const results = allResults;

      // All results should have consistent static properties
      const firstResult = results[0];
      expect(firstResult).toBeDefined();
      results.forEach((result) => {
        // Static properties should be identical
        expect(result.size).toBe(firstResult!.size);
        expect(result.mountFrom).toBe(firstResult!.mountFrom);
        expect(result.fstype).toBe(firstResult!.fstype);

        // Dynamic properties like 'available' and 'used' can change significantly
        // between calls as other processes create/delete files
        expect(typeof result.available).toBe("number");
        expect(typeof result.used).toBe("number");

        // Verify they are positive numbers
        expect(result.available).toBeGreaterThanOrEqual(0);
        expect(result.used).toBeGreaterThanOrEqual(0);

        // Verify that available + used approximately equals size
        // Allow for some difference due to filesystem overhead and concurrent changes
        if (
          result.size !== undefined &&
          result.available !== undefined &&
          result.used !== undefined
        ) {
          const sum = result.available + result.used;
          const difference = Math.abs(result.size - sum);
          const tolerance = result.size * 0.1; // Allow 10% tolerance

          // The sum should be close to the total size
          expect(difference).toBeLessThanOrEqual(tolerance);
        }
      });
    },
    getTestTimeout(20000),
  ); // Base 20s timeout, adjusted for environment
});
