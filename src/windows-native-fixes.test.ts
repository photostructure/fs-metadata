// src/windows-native-fixes.test.ts
// Tests to verify the Windows native code fixes:
// 1. FindHandleGuard - proper cleanup with FindClose (not CloseHandle)
// 2. Promise/future timeout - no detached threads, proper timeout handling
// 3. WorkQueue - proper error handling
// 4. VolumeInfo/DiskSpaceInfo - initialized members

import {
  getAllVolumeMetadata,
  getVolumeMetadata,
  getVolumeMountPoints,
} from "./index";
import { describePlatformStable, systemDrive } from "./test-utils/platform";

describePlatformStable("win32")("Windows Native Code Fixes", () => {
  // Helper to get handle count from process report
  const getHandleCount = (): number => {
    if (!process.report) return 0;
    const report = process.report.getReport() as {
      header?: { handleCount?: number };
    };
    return report?.header?.handleCount ?? 0;
  };

  describe("FindHandleGuard RAII Cleanup", () => {
    // This tests that FindFirstFileEx handles are properly closed with FindClose
    // If we were using CloseHandle instead, we'd see handle leaks
    it("should not leak search handles during drive status checks", async () => {
      const initialHandles = getHandleCount();

      // Perform many mount point enumerations which use FindFirstFileEx internally
      // for drive health checks
      for (let i = 0; i < 20; i++) {
        await getVolumeMountPoints({ timeoutMs: 5000 });
      }

      // Small delay for any async cleanup
      await new Promise((resolve) => setTimeout(resolve, 200));

      const finalHandles = getHandleCount();
      const leakedHandles = finalHandles - initialHandles;

      // Should not leak handles - allow small variance for system activity
      // If FindClose wasn't being called properly, we'd see ~20+ leaked handles
      expect(leakedHandles).toBeLessThan(5);
    });

    it("should not leak handles when checking individual volumes", async () => {
      const drive = systemDrive();
      const initialHandles = getHandleCount();

      // Repeatedly get metadata for the system drive
      for (let i = 0; i < 30; i++) {
        await getVolumeMetadata(drive);
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      const finalHandles = getHandleCount();
      const leakedHandles = finalHandles - initialHandles;

      expect(leakedHandles).toBeLessThan(5);
    });
  });

  describe("Promise/Future Timeout Behavior", () => {
    // This tests that our timeout implementation using future.wait_for() works correctly
    // The old implementation with detached threads had race conditions

    it("should respect timeout and return quickly", async () => {
      const shortTimeout = 100; // 100ms
      const startTime = Date.now();

      // Even with a very short timeout, this should return (possibly with timeout status)
      const result = await getVolumeMountPoints({ timeoutMs: shortTimeout });

      const elapsed = Date.now() - startTime;

      // Should complete within reasonable time (timeout + some overhead)
      // If the old detached thread implementation was still in use with bugs,
      // this could hang or take much longer
      expect(elapsed).toBeLessThan(shortTimeout + 2000);
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle rapid successive calls with different timeouts", async () => {
      // This tests that we don't have race conditions from the old detached thread approach
      const results = await Promise.all([
        getVolumeMountPoints({ timeoutMs: 50 }),
        getVolumeMountPoints({ timeoutMs: 100 }),
        getVolumeMountPoints({ timeoutMs: 150 }),
        getVolumeMountPoints({ timeoutMs: 200 }),
        getVolumeMountPoints({ timeoutMs: 5000 }),
      ]);

      // All should return valid arrays
      for (const result of results) {
        expect(Array.isArray(result)).toBe(true);
      }
    });

    it("should not have promise race conditions under concurrent load", async () => {
      // Launch many concurrent operations - the old code had a race where both
      // worker thread and timeout thread could try to set the promise value
      const promises: Promise<unknown>[] = [];

      for (let i = 0; i < 30; i++) {
        promises.push(getVolumeMountPoints({ timeoutMs: 100 + i * 10 }));
      }

      // None of these should throw due to "promise already satisfied" errors
      const results = await Promise.allSettled(promises);

      // All should fulfill (not reject with internal errors)
      const rejections = results.filter((r) => r.status === "rejected");
      expect(rejections.length).toBe(0);
    });
  });

  describe("Error Handling Robustness", () => {
    it("should handle invalid paths gracefully", async () => {
      // These should not crash, even with security validation
      const invalidPaths = [
        "", // empty
        "Z:\\NonExistent\\Path", // non-existent drive
        "\\\\?\\InvalidDevice", // device namespace (should be rejected by security)
      ];

      for (const path of invalidPaths) {
        // Should either return error metadata or throw a clean error, not crash
        try {
          const result = await getVolumeMetadata(path);
          // If it returns, should have error info or empty/null values
          expect(result).toBeDefined();
        } catch (error) {
          // Clean error is acceptable
          expect(error).toBeInstanceOf(Error);
        }
      }
    });

    it("should handle NOT_READY drives without reading uninitialized memory", async () => {
      // This indirectly tests that VolumeInfo and DiskSpaceInfo have initialized members
      // When a drive returns ERROR_NOT_READY, the code should return safely
      // with zeroed/empty values rather than garbage from uninitialized memory

      const result = await getVolumeMountPoints({ timeoutMs: 5000 });

      // Check that all returned mount points have valid (non-garbage) data
      for (const mp of result) {
        // These should be valid strings, not garbage from uninitialized memory
        expect(typeof mp.mountPoint).toBe("string");
        expect(mp.mountPoint.length).toBeLessThan(1000); // Reasonable length

        if (mp.fstype != null) {
          expect(typeof mp.fstype).toBe("string");
          expect(mp.fstype.length).toBeLessThan(100);
        }

        expect(typeof mp.status).toBe("string");
        expect([
          "healthy",
          "timeout",
          "inaccessible",
          "disconnected",
          "unknown",
        ]).toContain(mp.status);
      }
    });
  });

  describe("Thread Pool and WorkQueue", () => {
    it("should handle high concurrency without deadlock", async () => {
      // Test that the thread pool handles many concurrent requests
      // This exercises the WorkQueue and event signaling
      const promises: Promise<unknown>[] = [];

      for (let i = 0; i < 100; i++) {
        promises.push(getVolumeMountPoints());
      }

      // Should complete within reasonable time (not deadlock)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Deadlock detected")), 30000),
      );

      await expect(
        Promise.race([Promise.all(promises), timeoutPromise]),
      ).resolves.toBeDefined();
    });

    it("should clean up resources after batch operations", async () => {
      const initialHandles = getHandleCount();

      // Run several batches of operations
      for (let batch = 0; batch < 5; batch++) {
        const promises = [];
        for (let i = 0; i < 20; i++) {
          promises.push(getAllVolumeMetadata());
        }
        await Promise.all(promises);
      }

      // Give time for cleanup
      await new Promise((resolve) => setTimeout(resolve, 500));

      const finalHandles = getHandleCount();
      const handleGrowth = finalHandles - initialHandles;

      // Handle count should stay relatively stable
      // Large growth would indicate leaked handles from the thread pool
      expect(handleGrowth).toBeLessThan(20);
    });
  });
});
