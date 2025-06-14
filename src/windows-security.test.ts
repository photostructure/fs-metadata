// src/windows-security.test.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getVolumeMountPoints, isHidden, type MountPoint } from "./index";
import { describePlatform } from "./test-utils/platform";

// Use describePlatform to properly skip entire test suite on non-Windows platforms
describePlatform("win32")("Windows Security Tests", () => {
  describe("Path Traversal Protection", () => {
    it("should reject paths with ..", async () => {
      // These paths should be rejected either by our security validation
      // or by Windows itself when it tries to process the invalid path
      await expect(isHidden("..\\windows\\system32")).rejects.toThrow();
      await expect(isHidden("C:\\test\\..\\..\\windows")).rejects.toThrow();
    });

    it("should reject paths with null bytes", async () => {
      await expect(isHidden("C:\\test\0malicious")).rejects.toThrow(
        /invalid path/i,
      );
    });

    it("should reject device names", async () => {
      const deviceNames = ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"];
      for (const device of deviceNames) {
        await expect(isHidden(`C:\\${device}`)).rejects.toThrow(
          /invalid path/i,
        );
        await expect(isHidden(`C:\\${device}.txt`)).rejects.toThrow(
          /invalid path/i,
        );
      }
    });

    it("should reject alternate data streams", async () => {
      await expect(isHidden("C:\\test.txt:stream")).rejects.toThrow(
        /invalid path/i,
      );
      await expect(isHidden("C:\\test:$DATA")).rejects.toThrow(/invalid path/i);
    });

    it("should reject UNC device paths", async () => {
      await expect(isHidden("\\\\?\\C:\\test")).rejects.toThrow(
        /invalid path/i,
      );
      await expect(isHidden("\\\\.\\CON")).rejects.toThrow(/invalid path/i);
    });
  });

  describe("Buffer Overflow Protection", () => {
    it("should handle very long paths safely", async () => {
      const longPath = "C:\\" + "a".repeat(300);
      await expect(isHidden(longPath)).rejects.toThrow();
    });

    it("should handle paths with special characters", async () => {
      const tempDir = os.tmpdir();
      const testFile = path.join(tempDir, "test file with spaces.txt");

      try {
        fs.writeFileSync(testFile, "test");
        const hidden = await isHidden(testFile);
        expect(typeof hidden).toBe("boolean");
      } finally {
        if (fs.existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
      }
    });
  });

  describe("Invalid UTF-8 Handling", () => {
    it("should reject invalid UTF-8 sequences", async () => {
      // Invalid UTF-8 sequences
      const invalidPaths = [
        Buffer.from([0xc0, 0x80]).toString(), // Overlong encoding
        Buffer.from([0xff, 0xfe]).toString(), // Invalid start byte
      ];

      for (const invalidPath of invalidPaths) {
        await expect(isHidden(invalidPath)).rejects.toThrow();
      }
    });
  });

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
