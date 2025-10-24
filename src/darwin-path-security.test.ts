// Security tests for macOS path validation (Finding #1)
// These tests verify that path traversal attacks are prevented

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHidden, setHidden } from "./index";

describe("Security: Path Traversal Prevention (macOS)", () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    // Create a temporary directory structure for testing
    tempDir = mkdtempSync(join(tmpdir(), "fs-meta-security-"));
    testFile = join(tempDir, "test.txt");
    writeFileSync(testFile, "test content");
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, {
        recursive: true,
        force: true,
        maxRetries: process.platform === "win32" ? 3 : 1,
        retryDelay: process.platform === "win32" ? 100 : 0,
      });
    }
  });

  describe("Direct .. in path (current implementation catches)", () => {
    it("should reject path with ..", async () => {
      await expect(isHidden("/tmp/../etc/passwd")).rejects.toThrow(
        /directory traversal/i,
      );
    });

    it("should reject path with .. in middle", async () => {
      await expect(isHidden("/home/user/../root")).rejects.toThrow(
        /directory traversal/i,
      );
    });
  });

  describe("Bypasses that current implementation FAILS to catch", () => {
    it("should reject redundant separators with ..", async () => {
      // Current implementation checks for ".." but doesn't canonicalize
      // This path contains ".." but with redundant separators
      const maliciousPath = `${tempDir}/.//.//../etc/passwd`;

      // This SHOULD fail but currently passes the ".." check
      // because the path doesn't contain literal ".." as a substring
      await expect(isHidden(maliciousPath)).rejects.toThrow(
        /invalid|not found|permission denied/i,
      );
    });

    it("should reject path that resolves outside intended directory", async () => {
      // Create a test structure: tempDir/subdir/
      const subdir = join(tempDir, "subdir");
      mkdirSync(subdir);
      const fileInSubdir = join(subdir, "file.txt");
      writeFileSync(fileInSubdir, "content");

      // This path should escape subdir and access parent
      // It contains .. so should be rejected by both TypeScript and C++ layers
      const escapePath = `${subdir}/./../test.txt`;

      // Should be rejected by directory traversal check
      await expect(isHidden(escapePath)).rejects.toThrow(
        /directory traversal/i,
      );
    });

    it("should reject absolute path traversal", async () => {
      // Try to access root filesystem from temp directory
      const maliciousPath = "/../../../../../../etc/passwd";

      // This should be rejected as it tries to traverse to sensitive areas
      await expect(isHidden(maliciousPath)).rejects.toThrow();
    });

    it("should reject null byte injection combined with path", async () => {
      const nullBytePath = "/tmp\0/../etc/passwd";

      // TypeScript layer catches .. first, or invalid characters
      await expect(isHidden(nullBytePath)).rejects.toThrow(
        /directory traversal|invalid/i,
      );
    });
  });

  describe("setHidden should also prevent path traversal", () => {
    it("should reject direct ..", async () => {
      await expect(setHidden("/tmp/../etc/passwd", true)).rejects.toThrow(
        /directory traversal/i,
      );
    });

    it("should reject redundant separators", async () => {
      const maliciousPath = `${tempDir}/.//.//../etc/passwd`;

      await expect(setHidden(maliciousPath, true)).rejects.toThrow(
        /directory traversal|not found|permission denied/i,
      );
    });
  });

  describe("Canonicalization requirements", () => {
    it("should accept valid paths after canonicalization", async () => {
      // Valid path with redundant separators (should be normalized)
      const validPath = `${tempDir}//./test.txt`;

      // This should work after proper canonicalization
      const result = await isHidden(validPath);
      expect(typeof result).toBe("boolean");
    });

    it("should handle symlinks safely", async () => {
      // This test verifies that symlinks are resolved
      // For now, just test that normal operation works
      const result = await isHidden(testFile);
      expect(typeof result).toBe("boolean");
    });
  });

  describe("Edge cases", () => {
    it("should reject empty path", async () => {
      await expect(isHidden("")).rejects.toThrow();
    });

    it("should reject very long paths", async () => {
      // PATH_MAX on macOS is typically 1024
      const longPath = "/tmp/" + "a".repeat(2000);

      await expect(isHidden(longPath)).rejects.toThrow();
    });

    it("should handle root directory", async () => {
      // Root should be accessible
      const result = await isHidden("/");
      expect(typeof result).toBe("boolean");
    });
  });
});
