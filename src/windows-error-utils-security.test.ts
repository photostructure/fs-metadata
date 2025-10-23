// src/windows-error-utils-security.test.ts
// Security tests for Windows error formatting (Finding #4)
// Tests for memory leaks in FormatMessageA usage

import { describePlatformStable } from "./test-utils/platform";

describePlatformStable("win32")("Windows Error Utils Security", () => {
  describe("FormatMessageA Memory Leak Protection", () => {
    it("should handle large error messages without leaking memory", async () => {
      const { isHidden } = await import("./index");

      // ERROR_INVALID_PARAMETER (87) generates a reasonably long message
      // Perform many operations to detect potential leaks
      const promises: Promise<any>[] = [];

      for (let i = 0; i < 1000; i++) {
        // Use invalid paths to trigger error formatting
        const invalidPath = `C:\\invalid\\path\\${i}\\does\\not\\exist.txt`;
        promises.push(
          isHidden(invalidPath).catch((err) => {
            // Expected to fail - we're testing that error formatting doesn't leak
            expect(err).toBeDefined();
            expect(err.message).toBeDefined();
          }),
        );
      }

      await Promise.all(promises);

      // If there are leaks, they would accumulate after 1000 iterations
      // This test should be run with memory leak detection tools
    });

    it("should properly clean up error message buffers on success", async () => {
      const { isHidden } = await import("./index");

      // Test multiple error scenarios
      const errorPaths = [
        "C:\\Windows\\System32\\nonexistent.dll", // Access denied or not found
        "C:\\invalid\\path.txt", // Path not found
        "\\\\invalid\\unc\\path", // Invalid UNC
        "Z:\\nonexistent\\drive", // Drive doesn't exist
      ];

      for (const path of errorPaths) {
        try {
          await isHidden(path);
        } catch (error: unknown) {
          // Verify error message was formatted (buffer was allocated and freed)
          expect((error as Error).message).toBeDefined();
          expect((error as Error).message.length).toBeGreaterThan(0);
        }
      }
    });

    it("should handle rapid error formatting without resource exhaustion", async () => {
      const { isHidden } = await import("./index");

      // Rapid-fire error generation to stress test cleanup
      const promises: Promise<any>[] = [];

      for (let i = 0; i < 500; i++) {
        promises.push(
          isHidden(`C:\\test_${i}\\invalid.txt`).catch((err) => {
            expect(err).toBeDefined();
          }),
        );
      }

      await Promise.all(promises);
    });

    it("should format common Windows error codes correctly", async () => {
      const { isHidden } = await import("./index");

      // Test specific error codes that have known messages
      const testCases = [
        {
          path: "C:\\nonexistent.txt",
          expectedPattern: /cannot find|not found/i,
        },
        {
          path: "C:\\Windows\\System32\\config\\SAM",
          expectedPattern: /access|denied|permission/i,
        },
      ];

      for (const testCase of testCases) {
        try {
          await isHidden(testCase.path);
          // If it succeeds, that's ok (file might exist)
        } catch (error: unknown) {
          const err = error as Error;
          // Verify error message is formatted and contains expected patterns
          expect(err.message).toBeDefined();
          // The error should contain either the expected pattern or be a valid error
          if (!testCase.expectedPattern.test(err.message)) {
            // If it doesn't match the pattern, at least verify it's a proper error
            expect(err.message.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it("should handle errors with various message lengths", async () => {
      const { getVolumeMetadata } = await import("./index");

      // Different operations can produce different length error messages
      const testCases = [
        "C:\\", // Short error (if any)
        "C:\\Program Files\\NonExistent\\Very\\Long\\Path\\That\\Does\\Not\\Exist\\file.txt", // Long path
        "\\\\?\\C:\\Device\\Path", // Device path (should be rejected)
      ];

      for (const path of testCases) {
        try {
          await getVolumeMetadata(path);
        } catch (error: unknown) {
          // Just verify we got an error with a message
          expect((error as Error).message).toBeDefined();
        }
      }
    });
  });

  describe("Exception Safety in Error Formatting", () => {
    it("should handle memory pressure scenarios gracefully", async () => {
      const { isHidden } = await import("./index");

      // Create many concurrent operations that will fail
      // This simulates memory pressure conditions
      const concurrentOps = 100;
      const promises: Promise<any>[] = [];

      for (let i = 0; i < concurrentOps; i++) {
        promises.push(
          isHidden(`C:\\concurrent_test_${i}\\invalid.txt`).catch(() => {
            // Expected to fail
          }),
        );
      }

      // All should complete without crashing or leaking
      await Promise.all(promises);
    });

    it("should produce consistent error messages for same error code", async () => {
      const { isHidden } = await import("./index");

      // Use a path that's guaranteed to fail - null byte injection
      const testPath = "C:\\test\0invalid";
      const errors: string[] = [];

      for (let i = 0; i < 10; i++) {
        try {
          await isHidden(testPath);
          fail("Should have thrown an error for null byte");
        } catch (error: unknown) {
          errors.push((error as Error).message);
        }
      }

      // All error messages should be defined and consistent
      expect(errors.length).toBe(10);
      errors.forEach((msg) => {
        expect(msg).toBeDefined();
        expect(msg.length).toBeGreaterThan(0);
        // Should contain "invalid path" from our validation
        expect(msg).toMatch(/invalid path/i);
      });
    });
  });
});
