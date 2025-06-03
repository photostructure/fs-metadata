import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
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

// For testing invalid tasks
type WorkerTaskWithInvalid = WorkerTask | { task: string };

type WorkerResult<T> =
  | { success: true; result: T }
  | { success: false; error: string };

// Worker code that will be executed in worker threads
const workerCode = `
const { parentPort, workerData } = require('node:worker_threads');
const fsMetadata = require('${process.cwd()}/dist/index.cjs');

async function runWorkerTask() {
  try {
    const { task, ...params } = workerData;
    let result;
    
    switch (task) {
      case 'getVolumeMountPoints':
        result = await fsMetadata.getVolumeMountPoints();
        break;
      case 'getVolumeMetadata':
        result = await fsMetadata.getVolumeMetadata(params.mountPoint, params.options);
        break;
      case 'isHidden':
        result = await fsMetadata.isHidden(params.path);
        break;
      case 'setHidden':
        result = await fsMetadata.setHidden(params.path, params.hidden);
        break;
      default:
        throw new Error('Unknown task: ' + task);
    }
    
    parentPort.postMessage({ success: true, result });
  } catch (error) {
    parentPort.postMessage({ success: false, error: error.message });
  }
}

runWorkerTask();
`;

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
      const worker = new Worker(workerCode, {
        eval: true,
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
    const mainThreadResult = await getVolumeMountPoints();
    const workerResult = await runInWorker<MountPoint[]>({
      task: "getVolumeMountPoints",
    });

    // Results should have the same structure and mount points
    expect(workerResult.length).toBe(mainThreadResult.length);
    expect(workerResult.length).toBeGreaterThan(0);

    // Compare mount points (status might differ due to timing)
    for (let i = 0; i < workerResult.length; i++) {
      const workerItem = workerResult[i];
      const mainItem = mainThreadResult[i];
      expect(workerItem?.mountPoint).toBe(mainItem?.mountPoint);
      expect(workerItem?.fstype).toBe(mainItem?.fstype);
      expect(workerItem?.isSystemVolume).toBe(mainItem?.isSystemVolume);
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

    // Compare key properties
    expect(workerResult.size).toBe(mainThreadResult.size);
    expect(workerResult.available).toBe(mainThreadResult.available);
    expect(workerResult.used).toBe(mainThreadResult.used);
    expect(workerResult.mountFrom).toBe(mainThreadResult.mountFrom);
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
      } as WorkerTaskWithInvalid as WorkerTask),
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

    // All results should be identical since they're querying the same mount point
    const firstResult = results[0];
    expect(firstResult).toBeDefined();
    results.forEach((result) => {
      expect(result.size).toBe(firstResult!.size);
      expect(result.available).toBe(firstResult!.available);
      expect(result.mountFrom).toBe(firstResult!.mountFrom);
    });
  });
});
