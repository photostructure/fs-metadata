// src/windows-input-security.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isHidden } from "./index";
import { describePlatformStable } from "./test-utils/platform";

// Input validation security tests - these test handling of malicious inputs
// These don't require debug builds and can run with regular Release builds
describePlatformStable("win32")("Windows Input Security Tests", () => {
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
      // With PathCchCanonicalizeEx, 300 chars is now supported
      // Test that paths that don't exist still fail gracefully
      const longPath = "C:\\" + "a".repeat(300);

      // Should not crash, but will fail because path doesn't exist
      try {
        await isHidden(longPath);
      } catch (error: any) {
        expect(error.message).toMatch(/not found|cannot find|access denied/i);
      }
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

  describe("Long Path Support (PathCchCanonicalizeEx)", () => {
    it("should handle paths longer than MAX_PATH (260 chars)", async () => {
      // Create a path that exceeds MAX_PATH but is within PATHCCH_MAX_CCH (32,768)
      // Use nested directories to create a deep path
      const tempDir = os.tmpdir();
      const longDirName = "a".repeat(50);

      // Build a path > 260 characters
      let testPath = tempDir;
      const iterations = Math.ceil((270 - tempDir.length) / 51); // 50 chars + separator

      for (let i = 0; i < iterations; i++) {
        testPath = path.join(testPath, longDirName);
      }

      expect(testPath.length).toBeGreaterThan(260);

      // On Windows 10+ with long path support enabled, this should work
      // On older systems or without long path support, it may fail
      // We just verify it doesn't crash the process
      try {
        await isHidden(testPath);
      } catch (error: any) {
        // Expected errors: file not found, path not found, or access denied
        // These are acceptable - we're testing it doesn't crash
        expect(error.message).toMatch(
          /not found|cannot find|access denied|invalid path/i,
        );
      }
    });

    it("should reject paths exceeding PATHCCH_MAX_CCH limit", async () => {
      // PATHCCH_MAX_CCH is 32,768 wide characters
      // UTF-8 worst case: 3 bytes per character, so ~98,304 bytes
      // Create a path that exceeds this
      const excessivePath = "C:\\" + "a".repeat(100000);

      await expect(isHidden(excessivePath)).rejects.toThrow(/invalid path/i);
    });

    it("should handle paths at the boundary of MAX_PATH", async () => {
      // Test path exactly at MAX_PATH (260 characters)
      const tempDir = os.tmpdir();
      const remaining = 260 - tempDir.length - 2; // -2 for separator and null

      if (remaining > 0) {
        const boundaryPath = path.join(tempDir, "a".repeat(remaining));
        expect(boundaryPath.length).toBeLessThanOrEqual(260);

        // This should work even on systems without long path support
        try {
          await isHidden(boundaryPath);
        } catch (error: any) {
          // File not found is acceptable - we're testing path handling
          expect(error.message).toMatch(/not found|cannot find|access denied/i);
        }
      }
    });

    it("should normalize paths with mixed separators correctly", async () => {
      const tempDir = os.tmpdir();
      const mixedPath = tempDir.replace(/\\/g, "/") + "\\test/file.txt";

      // Should handle mixed separators without crashing
      try {
        await isHidden(mixedPath);
      } catch (error: any) {
        // Expected to fail (file doesn't exist), but shouldn't crash
        expect(error.message).toMatch(
          /not found|cannot find|access denied|invalid path/i,
        );
      }
    });

    it("should handle Unicode paths correctly", async () => {
      const tempDir = os.tmpdir();
      // Test with various Unicode characters that expand to multiple UTF-8 bytes
      const unicodePaths = [
        path.join(tempDir, "test_文件.txt"), // Chinese
        path.join(tempDir, "test_файл.txt"), // Russian
        path.join(tempDir, "test_🚀.txt"), // Emoji (4 bytes in UTF-8)
      ];

      for (const unicodePath of unicodePaths) {
        try {
          await isHidden(unicodePath);
        } catch (error: any) {
          // Expected to fail (file doesn't exist), but shouldn't crash
          expect(error.message).toMatch(
            /not found|cannot find|access denied|invalid path/i,
          );
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
});
