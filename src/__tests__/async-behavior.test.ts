// src/__tests__/async-behavior.test.ts

import { getVolumeMetadata, getVolumeMountPoints } from "../index.js";
import { describePlatform } from "../test-utils/platform.js";

describe("Filesystem API Async Behavior", () => {
  const describeLinux = describePlatform("linux");

  // Helper to measure execution time
  const timeExecution = async (fn: () => Promise<unknown>): Promise<number> => {
    const start = process.hrtime();
    await fn();
    const [seconds, nanoseconds] = process.hrtime(start);
    return seconds * 1000 + nanoseconds / 1_000_000; // Convert to milliseconds
  };

  // Test concurrent operations
  describe("Concurrent Operations", () => {
    it("should handle multiple concurrent getVolumeMountPoints calls", async () => {
      const numCalls = 5;
      const promises = Array.from({ length: numCalls }, () =>
        getVolumeMountPoints(),
      );
      const results = await Promise.all(promises);

      // All results should be arrays
      for (const ea of results) {
        expect(Array.isArray(ea)).toBe(true);
        expect(ea.length).toBeGreaterThan(0);
      }

      // All results should be identical
      const first = results.shift();
      for (const ea of results) {
        expect(ea).toEqual(first);
      }
    });

    it("should handle multiple concurrent getVolumeMetadata calls", async () => {
      const mountPoints = await getVolumeMountPoints();
      const testPath = mountPoints[0]; // Use first available mountpoint

      const numCalls = 5;
      const promises = Array(numCalls)
        .fill(0)
        .map(() => getVolumeMetadata(testPath));
      const results = await Promise.all(promises);

      // All results should have valid metadata
      results.forEach((metadata) => {
        expect(metadata.mountPoint).toBe(testPath);
        expect(typeof metadata.size).toBe("number");
        expect(metadata.size).toBeGreaterThan(0);
      });
    });
  });

  describeLinux("Linux Implementation", () => {
    it("should complete filesystem operations quickly on accessible paths", async () => {
      const executionTime = await timeExecution(() => getVolumeMountPoints());
      // Even synchronous operations should be fast for accessible paths
      expect(executionTime).toBeLessThan(1000); // Less than 1 second
    });

    // This test demonstrates the potential blocking behavior
    it("should potentially block on slow filesystem operations", async () => {
      const mountPoints = await getVolumeMountPoints();

      // Start multiple concurrent operations
      const startTime = Date.now();
      const operations = mountPoints
        .slice(0, 3)
        .map((mp) => getVolumeMetadata(mp));
      await Promise.all(operations);
      const duration = Date.now() - startTime;

      // Operations ran synchronously, so total time is roughly sum of individual times
      console.log(
        `Time taken for ${operations.length} operations: ${duration}ms`,
      );
    });

    // Note: We might want to add tests for network filesystems,
    // but those would need careful setup and could be unreliable
    it.todo("should handle slow network filesystems without blocking");
  });
});
