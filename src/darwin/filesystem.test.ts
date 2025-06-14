// src/darwin/filesystem.test.ts
// Platform-specific tests for macOS filesystem behavior (APFS vs HFS+)

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getVolumeMetadata, isHidden, setHidden } from "../index";
import { runItIf, tmpDirNotHidden } from "../test-utils/platform";

describe("macOS filesystem-specific tests", () => {
  let tempDir: string;

  beforeEach(async () => {
    await fs.mkdir(tmpDirNotHidden(), { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tmpDirNotHidden(), "macos-fs-tests-"));
  });

  afterEach(async () => {
    await fs
      .rm(tempDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 500,
      })
      .catch(() => {
        // Ignore cleanup failures
      });
  });

  runItIf(["darwin"])("should detect filesystem type", async () => {
    // Get filesystem type for temp directory
    const tempDirParent = path.dirname(tempDir);
    const metadata = await getVolumeMetadata(tempDirParent);

    expect(metadata).toBeDefined();
    expect(metadata.fstype).toBeDefined();
    expect(typeof metadata.fstype).toBe("string");

    // Common macOS filesystem types
    expect(["apfs", "hfs", "exfat", "msdos", "ntfs", "smbfs", "nfs"]).toContain(
      metadata.fstype?.toLowerCase() || "",
    );
  });

  runItIf(["darwin"])(
    "should handle chflags on different filesystems",
    async () => {
      const testFile = path.join(tempDir, "test-chflags.txt");
      await fs.writeFile(testFile, "test content");

      // Get filesystem type
      const metadata = await getVolumeMetadata(path.dirname(tempDir));
      const fstype = metadata.fstype?.toLowerCase() || "";

      try {
        // Try to set hidden using system flag
        const result = await setHidden(testFile, true, "systemFlag");

        // If successful, verify it worked
        expect(result.actions.systemFlag).toBe(true);
        expect(await isHidden(result.pathname)).toBe(true);

        // Unset hidden flag
        const unhideResult = await setHidden(
          result.pathname,
          false,
          "systemFlag",
        );
        expect(unhideResult.actions.systemFlag).toBe(true);
        expect(await isHidden(unhideResult.pathname)).toBe(false);
      } catch (error: unknown) {
        // If it fails on APFS, ensure we get an appropriate error
        if (
          fstype === "apfs" &&
          error instanceof Error &&
          error.message.includes("APFS")
        ) {
          // Expected behavior - APFS may have issues with chflags
          expect(error.message).toMatch(/APFS|chflags/);
        } else {
          // Re-throw unexpected errors
          throw error;
        }
      }
    },
  );

  runItIf(["darwin"])(
    "should use fallback methods on APFS if chflags fails",
    async () => {
      const testFile = path.join(tempDir, "test-fallback.txt");
      await fs.writeFile(testFile, "test content");

      // Use 'all' method which should try system flag first, then fall back to dot prefix
      const result = await setHidden(testFile, true, "all");

      // Should successfully hide the file using one method or the other
      expect(await isHidden(result.pathname)).toBe(true);
      expect(result.actions.dotPrefix || result.actions.systemFlag).toBe(true);

      // Unhide
      const unhideResult = await setHidden(result.pathname, false, "all");
      expect(await isHidden(unhideResult.pathname)).toBe(false);
    },
  );

  runItIf(["darwin"])(
    "should report detailed errors for permission issues",
    async () => {
      // Try to modify a system file that we don't have permission to change
      const systemFile =
        "/System/Library/CoreServices/.SystemVersionPlatform.plist";

      try {
        // Check if file exists first
        await fs.access(systemFile);

        // This should fail with permission error
        await setHidden(systemFile, true, "systemFlag");

        // Should not reach here
        expect(true).toBe(false);
      } catch (error: unknown) {
        // Should get a permission error or file not found
        // The error might be wrapped or have a different structure
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        expect(errorMessage).toMatch(
          /EPERM|EACCES|Permission denied|Operation not permitted|ENOENT|No such file|chflags failed/,
        );
      }
    },
  );

  runItIf(["darwin"])("should handle network volumes differently", async () => {
    const metadata = await getVolumeMetadata(path.dirname(tempDir));

    // Check if this is a network volume
    if (metadata.remote) {
      console.log(`Testing on network volume: ${metadata.fstype}`);

      const testFile = path.join(tempDir, "network-test.txt");
      await fs.writeFile(testFile, "test");

      // Network volumes may not support chflags
      try {
        await setHidden(testFile, true, "systemFlag");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/not supported|ENOTSUP/);
      }

      // But dot prefix should always work
      const result = await setHidden(testFile, true, "dotPrefix");
      expect(result.actions.dotPrefix).toBe(true);
      expect(await isHidden(result.pathname)).toBe(true);
    }
  });

  runItIf(["darwin"])(
    "should verify hidden attribute persistence",
    async () => {
      const testFile = path.join(tempDir, "persist-test.txt");
      await fs.writeFile(testFile, "test content");

      // Hide the file
      const hideResult = await setHidden(testFile, true);
      const hiddenPath = hideResult.pathname;

      // Verify it's hidden
      expect(await isHidden(hiddenPath)).toBe(true);

      // Modify the file content
      await fs.appendFile(hiddenPath, "\nmore content");

      // Verify it's still hidden after modification
      expect(await isHidden(hiddenPath)).toBe(true);

      // Verify using ls command
      if (hideResult.actions.systemFlag) {
        const lsOutput = execSync(`ls -lO "${path.dirname(hiddenPath)}"`, {
          encoding: "utf8",
        });
        const filename = path.basename(hiddenPath);
        const fileLines = lsOutput
          .split("\n")
          .filter((line) => line.includes(filename));

        if (fileLines.length > 0) {
          // Check for hidden flag in ls output
          expect(fileLines[0]).toMatch(/hidden/);
        }
      }
    },
  );

  runItIf(["darwin"])(
    "should handle case-sensitive vs case-insensitive filesystems",
    async () => {
      // APFS can be case-sensitive or case-insensitive
      const testFile1 = path.join(tempDir, "TestFile.txt");
      const testFile2 = path.join(tempDir, "testfile.txt");

      await fs.writeFile(testFile1, "test1");

      let caseSensitive = true;
      try {
        await fs.writeFile(testFile2, "test2");
        // If we can create both, filesystem is case-sensitive
      } catch {
        // If we can't create both, filesystem is case-insensitive
        caseSensitive = false;
      }

      console.log(
        `Filesystem is case-${caseSensitive ? "sensitive" : "insensitive"}`,
      );

      // Test hiding with different cases
      if (!caseSensitive) {
        // On case-insensitive filesystem, hiding should work regardless of case
        const result = await setHidden(testFile1.toLowerCase(), true);
        expect(await isHidden(result.pathname)).toBe(true);
      }
    },
  );
});
