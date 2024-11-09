// src/__tests__/async-behavior.test.ts
import { getMountpoints, getVolumeMetadata } from "../index";
import { describePlatform } from "../test-utils/platform";

describe("Filesystem API Async Behavior", () => {
  const describeLinux = describePlatform("linux");
  const describeWindows = describePlatform("win32");

  // Helper to measure execution time
  const timeExecution = async (fn: () => Promise<any>): Promise<number> => {
    const start = process.hrtime();
    await fn();
    const [seconds, nanoseconds] = process.hrtime(start);
    return seconds * 1000 + nanoseconds / 1_000_000; // Convert to milliseconds
  };

  // Test concurrent operations
  describe("Concurrent Operations", () => {
    it("should handle multiple concurrent getMountpoints calls", async () => {
      const numCalls = 5;
      const promises = Array(numCalls)
        .fill(0)
        .map(() => getMountpoints());
      const results = await Promise.all(promises);

      // All results should be arrays
      results.forEach((mountpoints) => {
        expect(Array.isArray(mountpoints)).toBe(true);
        expect(mountpoints.length).toBeGreaterThan(0);
      });

      // All results should be identical
      const [first, ...rest] = results;
      rest.forEach((mountpoints) => {
        expect(mountpoints).toEqual(first);
      });
    });

    it("should handle multiple concurrent getVolumeMetadata calls", async () => {
      const mountpoints = await getMountpoints();
      const testPath = mountpoints[0]; // Use first available mountpoint

      const numCalls = 5;
      const promises = Array(numCalls)
        .fill(0)
        .map(() => getVolumeMetadata(testPath));
      const results = await Promise.all(promises);

      // All results should have valid metadata
      results.forEach((metadata) => {
        expect(metadata.mountpoint).toBe(testPath);
        expect(typeof metadata.size).toBe("number");
        expect(metadata.size).toBeGreaterThan(0);
      });
    });
  });

  describeLinux("Linux Implementation", () => {
    it("should complete filesystem operations quickly on accessible paths", async () => {
      const executionTime = await timeExecution(() => getMountpoints());
      // Even synchronous operations should be fast for accessible paths
      expect(executionTime).toBeLessThan(1000); // Less than 1 second
    });

    // This test demonstrates the potential blocking behavior
    it("should potentially block on slow filesystem operations", async () => {
      const mountpoints = await getMountpoints();

      // Start multiple concurrent operations
      const startTime = Date.now();
      const operations = mountpoints
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
