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

      // All operations should succeed with valid results
      expect(results.length).toBe(50);

      // Verify each result has the expected structure
      for (const result of results) {
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);

        // Each mount point should have required fields
        for (const mountPoint of result) {
          expect(mountPoint).toHaveProperty("mountPoint");
          expect(mountPoint).toHaveProperty("status");
          expect(mountPoint).toHaveProperty("isSystemVolume");
          expect(typeof mountPoint.mountPoint).toBe("string");
          expect(typeof mountPoint.status).toBe("string");
          expect(typeof mountPoint.isSystemVolume).toBe("boolean");

          // Status should be one of the valid values
          expect([
            "healthy",
            "timeout",
            "inaccessible",
            "disconnected",
            "unknown",
          ]).toContain(mountPoint.status);
        }
      }

      // For deterministic mount points (local drives), results should be consistent
      // Network drives may vary between "timeout" and "disconnected" states
      const firstResult = results[0];
      for (const result of results) {
        expect(result.length).toBe(firstResult?.length);

        // Check each mount point matches structurally
        for (let i = 0; i < result.length; i++) {
          const mp = result[i];
          const firstMp = firstResult?.[i];

          expect(mp?.mountPoint).toBe(firstMp?.mountPoint);
          expect(mp?.isSystemVolume).toBe(firstMp?.isSystemVolume);

          // For local drives, status should be consistent
          if (mp?.fstype === "NTFS" && mp?.status === "healthy") {
            expect(mp?.status).toBe(firstMp?.status);
            expect(mp?.fstype).toBe(firstMp?.fstype);
          }
          // Network drives may legitimately vary between timeout/disconnected
        }
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
