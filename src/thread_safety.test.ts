import { getVolumeMetadata, getVolumeMountPoints } from "./index";
import { isAlpine, isARM64, isWindows } from "./platform";
import { runAdaptiveBenchmark } from "./test-utils/benchmark-harness";
import { describeSkipARM64CI } from "./test-utils/platform";
import { getTestTimeout } from "./test-utils/test-timeout-config";

describeSkipARM64CI("Thread Safety Tests", () => {
  // This test is designed to stress the Windows thread safety implementation
  // Without the atomic fixes, this could cause race conditions or crashes
  it(
    "should handle concurrent volume metadata requests without race conditions",
    async () => {
      if (!isWindows) {
        return;
      }

      // Skip on Alpine ARM64 due to emulation performance issues
      if (isAlpine() && isARM64) {
        return;
      }

      // Get all mount points
      const mountPoints = await getVolumeMountPoints();
      console.log(`Testing ${mountPoints.length} mount points concurrently`);

      // Store all results
      const allResults: {
        success: boolean;
        mountPoint: string;
        attempt: number;
        status?: string | undefined;
        error?: string;
      }[] = [];

      let currentAttempt = 0;

      // Use adaptive benchmark for concurrent requests
      await runAdaptiveBenchmark(
        async () => {
          const promises: Promise<{
            success: boolean;
            mountPoint: string;
            attempt: number;
            status?: string | undefined;
            error?: string;
          }>[] = [];

          // Create concurrent requests for each mount point
          for (const mountPoint of mountPoints) {
            promises.push(
              getVolumeMetadata(mountPoint.mountPoint)
                .then((metadata) => ({
                  success: true,
                  mountPoint: mountPoint.mountPoint,
                  attempt: currentAttempt,
                  status: metadata.status,
                }))
                .catch((error) => ({
                  success: false,
                  mountPoint: mountPoint.mountPoint,
                  attempt: currentAttempt,
                  error: error.message,
                })),
            );
          }

          // Wait for all operations to complete
          const iterationResults = await Promise.all(promises);
          allResults.push(...iterationResults);
          currentAttempt++;
        },
        {
          targetDurationMs: 2_000, // Target 2 seconds of testing
          maxTimeoutMs: 8_000, // Max 8 seconds
          minIterations: 5, // At least 5 iterations for consistency checking
          maxIterations: 50, // Don't go crazy with iterations
          debug: !!process.env["DEBUG_BENCHMARK"],
        },
      );

      // Analyze results
      const successCount = allResults.filter((r) => r.success).length;
      const failureCount = allResults.filter((r) => !r.success).length;
      const totalRequests = allResults.length;

      // Thread safety test results logging removed to prevent console issues

      // Group results by mount point to check consistency
      const resultsByMountPoint = new Map<string, (typeof allResults)[0][]>();
      for (const res of allResults) {
        const existing = resultsByMountPoint.get(res.mountPoint) || [];
        existing.push(res);
        resultsByMountPoint.set(res.mountPoint, existing);
      }

      // Verify consistency - all requests for the same mount point should return the same status
      let inconsistencies = 0;
      for (const [, mountResults] of resultsByMountPoint) {
        const statuses = new Set(mountResults.map((r) => r.status || r.error));
        if (statuses.size > 1) {
          inconsistencies++;
        }
      }

      // The test passes if we don't crash and have reasonable consistency
      expect(inconsistencies).toBe(0);
      expect(successCount + failureCount).toBe(totalRequests);
    },
    getTestTimeout(15_000),
  ); // Base 15s timeout, adjusted for environment

  // This test specifically targets the drive status checker timeout behavior
  it(
    "should handle timeouts gracefully without thread termination issues",
    async () => {
      if (!isWindows) {
        return;
      }

      const mountPoints = await getVolumeMountPoints();
      if (mountPoints.length === 0) {
        return;
      }

      const testMount = mountPoints[0]!;
      let totalRequests = 0;
      let currentIteration = 0;

      // Use adaptive benchmark to test timeout handling
      await runAdaptiveBenchmark(
        async () => {
          // Create rapid-fire requests with short timeouts
          // This tests the thread cleanup path that previously used TerminateThread
          const batchPromises: Promise<{
            success: boolean;
            iteration: number;
          }>[] = [];
          const batchSize = 5; // Run 5 concurrent requests per iteration

          for (let i = 0; i < batchSize; i++) {
            batchPromises.push(
              getVolumeMetadata(testMount.mountPoint, {
                timeoutMs: 10, // Very short timeout in ms
              })
                .then(() => ({ success: true, iteration: currentIteration }))
                .catch(() => ({ success: false, iteration: currentIteration })),
            );
            totalRequests++;
          }

          // Small delay between requests to create overlapping operations
          await new Promise((resolve) => setTimeout(resolve, 5));

          await Promise.all(batchPromises);
          currentIteration++;
        },
        {
          targetDurationMs: 2_000, // Target 2 seconds of testing
          maxTimeoutMs: 8_000, // Max 8 seconds
          minIterations: 4, // At least 4 iterations (20 requests minimum)
          debug: !!process.env["DEBUG_BENCHMARK"],
        },
      );

      // The test passes if we don't crash
      // We should have made at least the minimum number of requests
      expect(totalRequests).toBeGreaterThanOrEqual(20);
    },
    getTestTimeout(60_000),
  ); // Base 60s timeout for benchmark test on Windows

  // Memory stress test to detect potential memory leaks from improper thread cleanup
  it(
    "should not leak memory with repeated concurrent operations",
    async () => {
      if (!isWindows) {
        return;
      }

      // Skip on Alpine ARM64 due to emulation performance issues
      if (isAlpine() && isARM64) {
        return;
      }

      const mountPoints = await getVolumeMountPoints();
      if (mountPoints.length === 0) {
        return;
      }

      // Get initial memory usage
      const initialMemory = process.memoryUsage();

      // Force garbage collection before starting
      if (global.gc) {
        global.gc();
      }

      const requestsPerIteration = 50;

      // Run adaptive benchmark with concurrent operations
      await runAdaptiveBenchmark(
        async () => {
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
        },
        {
          targetDurationMs: 5_000, // Target 5 seconds of testing
          maxTimeoutMs: 15_000, // Max 15 seconds
          minIterations: 3, // At least 3 iterations to detect trends
          debug: !!process.env["DEBUG_BENCHMARK"],
        },
      );

      // Get final memory usage
      const finalMemory = process.memoryUsage();

      // Calculate memory growth
      const heapGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const heapGrowthMB = heapGrowth / 1024 / 1024;

      // Allow for some memory growth but fail if it's excessive
      // This would catch major leaks from improper thread cleanup
      expect(heapGrowthMB).toBeLessThan(50);
    },
    getTestTimeout(90_000),
  ); // Base 90s timeout for memory-intensive test on Windows
});
