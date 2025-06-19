// src/windows-memory-check.test.ts
// Alternative memory leak detection for Windows without debug builds
import { getVolumeMountPoints } from "./index";
import { describePlatformStable } from "./test-utils/platform";

// This test suite uses JavaScript-based memory monitoring instead of CRT debug heap
describePlatformStable("win32")(
  "Windows Memory Leak Detection (JavaScript)",
  () => {
    // Force garbage collection helper
    const forceGC = () => {
      if (global.gc) {
        global.gc();
        global.gc(); // Run twice for thoroughness
      }
    };

    // Helper to get stable memory reading
    const getStableMemory = async (): Promise<number> => {
      forceGC();
      await new Promise((resolve) => setTimeout(resolve, 100));
      forceGC();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return process.memoryUsage().heapUsed;
    };

    describe("Memory Usage Patterns", () => {
      it("should not leak memory on repeated getVolumeMountPoints calls", async () => {
        // Warm up
        for (let i = 0; i < 5; i++) {
          await getVolumeMountPoints();
        }

        const initialMemory = await getStableMemory();
        console.log(
          `Initial memory: ${(initialMemory / 1024 / 1024).toFixed(2)} MB`,
        );

        // Perform many operations
        const iterations = 100;
        for (let i = 0; i < iterations; i++) {
          await getVolumeMountPoints();

          // Check memory every 10 iterations
          if (i % 10 === 9) {
            const currentMemory = process.memoryUsage().heapUsed;
            console.log(
              `After ${i + 1} iterations: ${(currentMemory / 1024 / 1024).toFixed(2)} MB`,
            );
          }
        }

        const finalMemory = await getStableMemory();
        console.log(
          `Final memory: ${(finalMemory / 1024 / 1024).toFixed(2)} MB`,
        );

        const memoryIncrease = finalMemory - initialMemory;
        const increasePerIteration = memoryIncrease / iterations;

        console.log(
          `Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`,
        );
        console.log(
          `Per iteration: ${(increasePerIteration / 1024).toFixed(2)} KB`,
        );

        // Allow some memory increase but it should be minimal
        // If there's a leak, we'd see consistent growth per iteration
        // Note: Windows may have higher baseline memory usage due to system APIs
        expect(increasePerIteration).toBeLessThan(100 * 1024); // Less than 100KB per iteration
      });

      it("should release memory after operations with timeout", async () => {
        // Get baseline
        const baselineMemory = await getStableMemory();

        // Create many operations with short timeout
        const promises = [];
        for (let i = 0; i < 50; i++) {
          promises.push(getVolumeMountPoints({ timeoutMs: 50 }));
        }

        await Promise.all(promises);

        // Memory should increase during operations
        const duringOperationsMemory = process.memoryUsage().heapUsed;
        console.log(
          `During operations: ${(duringOperationsMemory / 1024 / 1024).toFixed(2)} MB`,
        );

        // After GC, memory should return close to baseline
        const afterGCMemory = await getStableMemory();
        console.log(`After GC: ${(afterGCMemory / 1024 / 1024).toFixed(2)} MB`);

        const retainedMemory = afterGCMemory - baselineMemory;
        console.log(
          `Retained memory: ${(retainedMemory / 1024 / 1024).toFixed(2)} MB`,
        );

        // Should not retain more than 8MB after operations
        // Windows may retain more memory due to system API caching
        expect(retainedMemory).toBeLessThan(8 * 1024 * 1024);
      });

      it("should handle concurrent operations without excessive memory growth", async () => {
        const baselineMemory = await getStableMemory();

        // Run multiple batches of concurrent operations
        for (let batch = 0; batch < 5; batch++) {
          const promises = [];
          for (let i = 0; i < 20; i++) {
            promises.push(getVolumeMountPoints());
          }
          await Promise.all(promises);

          const batchMemory = process.memoryUsage().heapUsed;
          console.log(
            `Batch ${batch + 1} memory: ${(batchMemory / 1024 / 1024).toFixed(2)} MB`,
          );
        }

        const finalMemory = await getStableMemory();
        const totalIncrease = finalMemory - baselineMemory;

        console.log(
          `Total memory increase: ${(totalIncrease / 1024 / 1024).toFixed(2)} MB`,
        );

        // Memory increase should be reasonable for 100 total operations
        // Allow slightly more headroom for Windows system API allocations and GC timing variations
        expect(totalIncrease).toBeLessThan(15 * 1024 * 1024); // Less than 15MB total
      });
    });

    describe("Handle Leak Detection (Process Metrics)", () => {
      // On Windows, we can monitor handle count as a proxy for resource leaks
      if (process.platform === "win32" && process.report) {
        it("should not leak handles", async () => {
          // Get initial handle count from process report
          const getHandleCount = () => {
            const report = process.report.getReport() as {
              header?: { handleCount?: number };
            };
            return report?.header?.handleCount || 0;
          };

          const initialHandles = getHandleCount();
          console.log(`Initial handles: ${initialHandles}`);

          // Perform many operations
          for (let i = 0; i < 50; i++) {
            await getVolumeMountPoints();
          }

          // Small delay to ensure cleanup
          await new Promise((resolve) => setTimeout(resolve, 100));

          const finalHandles = getHandleCount();
          console.log(`Final handles: ${finalHandles}`);

          const handleIncrease = finalHandles - initialHandles;
          console.log(`Handle increase: ${handleIncrease}`);

          // Should not leak more than a few handles
          expect(handleIncrease).toBeLessThan(10);
        });
      }
    });
  },
);
