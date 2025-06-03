import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { _dirname } from "./dirname";
import { getVolumeMetadata, getVolumeMountPoints, isHidden } from "./index";
import { isMacOS, isWindows } from "./platform";
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
  | { success: false; error: string };

// Path to the worker helper file
const workerHelperPath = join(
  _dirname(),
  "test-utils",
  "worker-thread-helper.cjs",
);

describe("Worker Threads Support", () => {
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
      const worker = new Worker(workerHelperPath, {
        workerData,
      });

      worker.on("message", (message: WorkerResult<T>) => {
        if (message.success) {
          resolve(message.result);
        } else {
          reject(new Error(message.error));
        }
      });

      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) {
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
      console.log("No mount points available for testing");
      return;
    }

    const testMount = mountPoints[0]!;
    const mainThreadResult = await getVolumeMetadata(testMount.mountPoint);
    const workerResult = await runInWorker<VolumeMetadata>({
      task: "getVolumeMetadata",
      mountPoint: testMount.mountPoint,
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
      console.log("Skipping hidden attribute test on Linux");
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
      console.log("Skipping hidden attribute test on Linux");
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

  it("should handle concurrent operations from multiple worker threads", async () => {
    const mountPoints = await getVolumeMountPoints();
    if (mountPoints.length === 0) {
      console.log("No mount points available for testing");
      return;
    }

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
            mountPoint: mountPoints[0]!.mountPoint,
          }),
        );
      }
    }

    // All operations should complete successfully
    const results = await Promise.all(workers);
    expect(results).toHaveLength(workerCount);
    results.forEach((result) => {
      expect(result).toBeDefined();
    });
  });

  it("should handle errors gracefully in worker threads", async () => {
    // Test with invalid mount point
    await expect(
      runInWorker({
        task: "getVolumeMetadata",
        mountPoint: "/invalid/mount/point/that/does/not/exist",
      }),
    ).rejects.toThrow();

    // Test with invalid task
    await expect(
      runInWorker({
        task: "invalidTask",
      } as unknown as WorkerTask),
    ).rejects.toThrow("Unknown task");
  });

  it("should maintain thread isolation", async () => {
    // This test verifies that each worker has its own context
    // and operations in one worker don't affect another
    const mountPoints = await getVolumeMountPoints();
    if (mountPoints.length === 0) {
      console.log("No mount points available for testing");
      return;
    }

    // Run the same operation multiple times in parallel
    const parallelCount = 10;
    const promises: Promise<VolumeMetadata>[] = [];

    for (let i = 0; i < parallelCount; i++) {
      promises.push(
        runInWorker<VolumeMetadata>({
          task: "getVolumeMetadata",
          mountPoint: mountPoints[0]!.mountPoint,
          options: { timeoutMs: 5000 },
        }),
      );
    }

    const results = await Promise.all(promises);

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
  });
});
