// src/windows-input-security.test.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isHidden } from "./index";
import { describePlatform } from "./test-utils/platform";

// Input validation security tests - these test handling of malicious inputs
// These don't require debug builds and can run with regular Release builds
describePlatform("win32")("Windows Input Security Tests", () => {
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
});
