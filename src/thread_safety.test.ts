import { getVolumeMetadata, getVolumeMountPoints } from "./index";
import { isWindows } from "./platform";
import { getTestTimeout } from "./test-utils/test-timeout-config";

describe("Thread Safety Tests", () => {
  // This test is designed to stress the Windows thread safety implementation
  // Without the atomic fixes, this could cause race conditions or crashes
  it(
    "should handle concurrent volume metadata requests without race conditions",
    async () => {
      if (!isWindows) {
        console.log(
          "Skipping Windows thread safety test on non-Windows platform",
        );
        return;
      }

      // Get all mount points
      const mountPoints = await getVolumeMountPoints();
      console.log(`Testing ${mountPoints.length} mount points concurrently`);

      // Create multiple concurrent requests for each mount point
      const concurrentRequests = 10;
      const promises: Promise<{
        success: boolean;
        mountPoint: string;
        attempt: number;
        status?: string | undefined;
        error?: string;
      }>[] = [];

      // Create a high-pressure scenario with many concurrent operations
      for (let i = 0; i < concurrentRequests; i++) {
        for (const mountPoint of mountPoints) {
          promises.push(
            getVolumeMetadata(mountPoint.mountPoint)
              .then((metadata) => ({
                success: true,
                mountPoint: mountPoint.mountPoint,
                attempt: i,
                status: metadata.status,
              }))
              .catch((error) => ({
                success: false,
                mountPoint: mountPoint.mountPoint,
                attempt: i,
                error: error.message,
              })),
          );
        }
      }

      // Wait for all operations to complete
      const results = await Promise.all(promises);

      // Analyze results
      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;
      const totalRequests = mountPoints.length * concurrentRequests;

      console.log(`Thread safety test results:`);
      console.log(`  Total requests: ${totalRequests}`);
      console.log(`  Successful: ${successCount}`);
      console.log(`  Failed: ${failureCount}`);

      // Group results by mount point to check consistency
      const resultsByMountPoint = new Map<string, (typeof results)[0][]>();
      for (const result of results) {
        const existing = resultsByMountPoint.get(result.mountPoint) || [];
        existing.push(result);
        resultsByMountPoint.set(result.mountPoint, existing);
      }

      // Verify consistency - all requests for the same mount point should return the same status
      let inconsistencies = 0;
      for (const [mountPoint, mountResults] of resultsByMountPoint) {
        const statuses = new Set(mountResults.map((r) => r.status || r.error));
        if (statuses.size > 1) {
          console.warn(
            `Inconsistent results for ${mountPoint}: ${Array.from(statuses).join(", ")}`,
          );
          inconsistencies++;
        }
      }

      // The test passes if we don't crash and have reasonable consistency
      expect(inconsistencies).toBe(0);
      expect(successCount + failureCount).toBe(totalRequests);
    },
    getTestTimeout(5000),
  ); // Base 5s timeout, adjusted for environment

  // This test specifically targets the drive status checker timeout behavior
  it("should handle timeouts gracefully without thread termination issues", async () => {
    if (!isWindows) {
      console.log("Skipping Windows timeout test on non-Windows platform");
      return;
    }

    // Test with a very short timeout to trigger the timeout path
    const promises: Promise<{ success: boolean; iteration: number }>[] = [];
    const mountPoints = await getVolumeMountPoints();

    // Use first mount point for testing
    if (mountPoints.length > 0) {
      const testMount = mountPoints[0]!;

      // Create rapid-fire requests with short timeouts
      // This tests the thread cleanup path that previously used TerminateThread
      for (let i = 0; i < 20; i++) {
        promises.push(
          getVolumeMetadata(testMount.mountPoint, {
            timeoutMs: 10, // Very short timeout in ms
          })
            .then(() => ({ success: true, iteration: i }))
            .catch(() => ({ success: false, iteration: i })),
        );

        // Small delay between requests to create overlapping operations
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const results = await Promise.all(promises);
      const timeouts = results.filter((r) => !r.success).length;

      console.log(
        `Timeout test: ${timeouts} timeouts out of ${results.length} requests`,
      );

      // The test passes if we don't crash
      // The number of timeouts will vary based on system performance
      expect(results.length).toBe(20);
    }
  });

  // Memory stress test to detect potential memory leaks from improper thread cleanup
  it(
    "should not leak memory with repeated concurrent operations",
    async () => {
      if (!isWindows) {
        console.log("Skipping Windows memory test on non-Windows platform");
        return;
      }

      const mountPoints = await getVolumeMountPoints();
      if (mountPoints.length === 0) {
        console.log("No mount points available for testing");
        return;
      }

      // Get initial memory usage
      const initialMemory = process.memoryUsage();

      // Run multiple iterations of concurrent operations
      const iterations = 5;
      const requestsPerIteration = 50;

      for (let iter = 0; iter < iterations; iter++) {
        const promises: Promise<void>[] = [];

        for (let i = 0; i < requestsPerIteration; i++) {
          const mountPoint = mountPoints[i % mountPoints.length]!;
          promises.push(
            getVolumeMetadata(mountPoint.mountPoint)
              .then(() => undefined)
              .catch(() => undefined),
          );
        }

        await Promise.all(promises);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }

        // Small delay between iterations
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Get final memory usage
      const finalMemory = process.memoryUsage();

      // Calculate memory growth
      const heapGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const heapGrowthMB = heapGrowth / 1024 / 1024;

      console.log(`Memory test results:`);
      console.log(
        `  Initial heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      );
      console.log(
        `  Final heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      );
      console.log(`  Heap growth: ${heapGrowthMB.toFixed(2)} MB`);

      // Allow for some memory growth but fail if it's excessive
      // This would catch major leaks from improper thread cleanup
      expect(heapGrowthMB).toBeLessThan(50);
    },
    getTestTimeout(10000),
  ); // Base 10s timeout for memory-intensive test, adjusted for environment
});
