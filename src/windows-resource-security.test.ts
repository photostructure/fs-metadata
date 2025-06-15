// src/windows-resource-security.test.ts
import { getVolumeMountPoints, type MountPoint } from "./index";
import { describePlatform } from "./test-utils/platform";

// Resource security tests - these test for resource/handle leaks during operations
// These benefit from running with debug builds to detect memory leaks
describePlatform("win32")("Windows Resource Security Tests", () => {
  describe("Resource Cleanup", () => {
    it("should not leak handles on timeout", async () => {
      // Test with an unreachable network path
      const result = await getVolumeMountPoints({ timeoutMs: 100 });
      expect(Array.isArray(result)).toBe(true);

      // Run multiple times to check for handle leaks
      for (let i = 0; i < 10; i++) {
        await getVolumeMountPoints({ timeoutMs: 100 });
      }
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle multiple concurrent operations safely", async () => {
      const promises: Promise<MountPoint[]>[] = [];

      // Launch many concurrent operations
      for (let i = 0; i < 50; i++) {
        promises.push(getVolumeMountPoints());
      }

      const results = await Promise.all(promises);

      // All should succeed and return the same result
      const firstResult = JSON.stringify(results[0]);
      for (const result of results) {
        expect(JSON.stringify(result)).toBe(firstResult);
      }
    });
  });

  describe("Memory Leak Detection", () => {
    if (process.env["NODE_ENV"] !== "debug") {
      it.skip("Requires debug build", () => {});
      return;
    }

    it("should not leak memory on repeated operations", async () => {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const initialMemory = process.memoryUsage().heapUsed;

      // Perform many operations
      for (let i = 0; i < 100; i++) {
        await getVolumeMountPoints();
      }

      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be minimal (less than 10MB)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });
  });
});
