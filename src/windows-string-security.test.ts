// src/windows-string-security.test.ts
// Security tests for Windows string conversion functions
// Tests for Finding #3: Integer Overflow in String Conversion

import { describePlatformStable } from "./test-utils/platform";

describePlatformStable("win32")("Windows String Conversion Security", () => {
  describe("Integer Overflow Protection", () => {
    it("should reject extremely large string conversions", async () => {
      // Create a string that would cause WideToUtf8 to return a very large size
      // When MultiByteToWideChar/WideCharToMultiByte returns a size close to INT_MAX,
      // allocating (size - 1) bytes could overflow

      // This test is designed to fail initially because the current implementation
      // doesn't check for overflow

      // We can't easily create a string that causes INT_MAX overflow without
      // actually allocating huge amounts of memory, so we'll use the native module
      // to test this indirectly through path operations

      const { isHidden } = await import("./index");

      // Attempt 1: Very long path with multi-byte characters
      // Each emoji is 4 bytes in UTF-8, but we're limited by PATHCCH_MAX_CCH
      const hugeEmojiPath = "C:\\" + "🚀".repeat(50000);

      // This should fail gracefully, not crash with overflow
      await expect(isHidden(hugeEmojiPath)).rejects.toThrow(
        /invalid path|too long|exceeds/i,
      );
    });

    it("should handle strings at conversion size limits", async () => {
      const { isHidden } = await import("./index");

      // Test with maximum valid path length
      // PATHCCH_MAX_CCH = 32768, so close to that but not over
      const nearMaxPath = "C:\\" + "a".repeat(32760);

      // This should fail because path doesn't exist, not because of overflow
      try {
        await isHidden(nearMaxPath);
      } catch (error: unknown) {
        // Should get a file-not-found error, not a conversion error
        expect((error as Error).message).toMatch(
          /not found|cannot find|access denied/i,
        );
        // Should NOT get conversion/overflow errors
        expect((error as Error).message).not.toMatch(/conversion|overflow/i);
      }
    });

    it("should validate conversion sizes are positive", async () => {
      const { isHidden } = await import("./index");

      // Test with invalid UTF-8 sequences that might cause
      // WideCharToMultiByte to return 0 or negative values
      const invalidUtf8 = Buffer.from([
        0xc0,
        0x80, // Overlong encoding
        0xff,
        0xfe, // Invalid start byte
      ]).toString();

      await expect(isHidden(invalidUtf8)).rejects.toThrow();
    });

    it("should handle multi-byte UTF-8 characters correctly", async () => {
      const { isHidden } = await import("./index");

      // Test with characters that expand to multiple bytes in UTF-8
      const paths = [
        "C:\\test_文件_" + "中".repeat(1000) + ".txt", // 3 bytes per char
        "C:\\test_файл_" + "д".repeat(1000) + ".txt", // 2 bytes per char
        "C:\\test_emoji_" + "🚀".repeat(500) + ".txt", // 4 bytes per char
      ];

      for (const testPath of paths) {
        try {
          await isHidden(testPath);
        } catch (error: unknown) {
          // Should fail gracefully (file not found), not crash
          expect((error as Error).message).toMatch(
            /not found|cannot find|access denied|invalid path/i,
          );
        }
      }
    });

    it("should enforce reasonable size limits on conversions", async () => {
      const { isHidden } = await import("./index");

      // Test that we reject conversions that would result in
      // unreasonably large allocations (> 1MB sanity check)

      // Since paths are limited to PATHCCH_MAX_CCH * 3 bytes in UTF-8,
      // which is ~98KB, this should be caught by path validation
      const megabytePath = "C:\\" + "a".repeat(1024 * 1024);

      await expect(isHidden(megabytePath)).rejects.toThrow(/invalid path/i);
    });
  });

  describe("Conversion Error Handling", () => {
    it("should detect failed UTF-8 to wide character conversion", async () => {
      const { isHidden } = await import("./index");

      // Invalid UTF-8 sequences
      const invalidSequences = [
        Buffer.from([0xc0, 0x80]).toString(), // Overlong NUL
        Buffer.from([0xed, 0xa0, 0x80]).toString(), // UTF-16 surrogate
        Buffer.from([0xff, 0xff]).toString(), // Invalid bytes
      ];

      for (const invalid of invalidSequences) {
        await expect(isHidden(invalid)).rejects.toThrow();
      }
    });

    it("should handle empty strings gracefully", async () => {
      const { isHidden } = await import("./index");

      // Empty string should be rejected as invalid path
      await expect(isHidden("")).rejects.toThrow(/invalid|empty/i);
    });

    it("should handle null-like inputs", async () => {
      const { isHidden } = await import("./index");

      // Null bytes in path
      await expect(isHidden("C:\\test\0malicious")).rejects.toThrow(
        /invalid path/i,
      );
    });
  });

  describe("Stress Testing String Conversions", () => {
    it("should handle many conversions without memory issues", async () => {
      const { isHidden } = await import("./index");

      // Perform many conversions to detect potential leaks
      // in error handling paths
      const promises: Promise<unknown>[] = [];

      for (let i = 0; i < 100; i++) {
        const testPath = `C:\\test_${i}_${"a".repeat(100)}.txt`;
        promises.push(
          isHidden(testPath).catch((err) => {
            // Expected to fail, just checking for crashes/leaks
            expect(err).toBeDefined();
          }),
        );
      }

      await Promise.all(promises);
    });

    it("should handle rapid conversions with multi-byte characters", async () => {
      const { isHidden } = await import("./index");

      const promises: Promise<unknown>[] = [];

      for (let i = 0; i < 50; i++) {
        const testPath = `C:\\测试_${i}_${"文".repeat(50)}.txt`;
        promises.push(
          isHidden(testPath).catch((err) => {
            expect(err).toBeDefined();
          }),
        );
      }

      await Promise.all(promises);
    });
  });
});
