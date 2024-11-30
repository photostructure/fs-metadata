import { jest } from "@jest/globals";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { statAsync } from "../fs_promises.js";
import { createHiddenPosixPath, LocalSupport } from "../hidden.js";
import {
  getHiddenMetadata,
  isHidden,
  isHiddenRecursive,
  setHidden,
} from "../index.js";
import { isWindows } from "../platform.js";
import { validateHidden } from "../test-utils/hidden-tests.js";
import { systemDrive, tmpDirNotHidden } from "../test-utils/platform.js";

describe("hidden file tests", () => {
  let tempDir: string;

  beforeEach(async () => {
    await fs.mkdir(tmpDirNotHidden(), { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tmpDirNotHidden(), "hidden-tests-"));
  });

  afterEach(async () => {
    await fs
      .rm(tempDir, { recursive: true, force: true })
      .catch((err) => console.warn(`Failed to rm ${tempDir}: ${err}`));
  });

  it("runs validateHidden()", () => validateHidden(tempDir));

  describe("isHidden()", () => {
    if (isWindows) {
      it("should detect hidden files (Windows)", async () => {
        const testFile = path.join(tempDir, "hidden.txt");
        await fs.writeFile(testFile, "test");
        execSync(`attrib +h "${testFile}"`);
        expect(await isHidden(testFile)).toBe(true);
      });
    } else {
      it("should detect hidden files by dot (POSIX)", async () => {
        expect(await isHidden(path.join(tempDir, ".hidden.txt"))).toBe(true);
      });
    }

    it("should not detect normal files as hidden", async () => {
      const testFile = path.join(tempDir, "normal.txt");
      await fs.writeFile(testFile, "test");
      expect(await isHidden(testFile)).toBe(false);
    });

    it("should not detect normal directories as hidden", async () => {
      const testDir = path.join(tempDir, "normal-dir");
      await fs.mkdir(testDir, { recursive: true });
      expect(await isHidden(testDir)).toBe(false);
    });

    it("should not detect .../. or .../.. directories as hidden", async () => {
      expect(await isHidden(path.join(tempDir, "."))).toBe(false);
      expect(await isHidden(path.join(tempDir, ".."))).toBe(false);
    });

    if (isWindows) {
      it("should detect hidden directories (Windows)", async () => {
        const testDir = path.join(tempDir, "hiddenDir");
        await fs.mkdir(testDir);
        execSync(`attrib +h "${testDir}"`);
        expect(await isHidden(testDir)).toBe(true);
      });
    } else {
      it("should detect hidden directories by dot (POSIX)", async () => {
        const testDir = path.join(tempDir, ".hidden");
        await fs.mkdir(testDir, { recursive: true });
        expect(await isHidden(testDir)).toBe(true);
      });
    }

    if (isWindows) {
      it("should not treat dot-prefixed files as hidden on Windows", async () => {
        const testFile = path.join(tempDir, ".gitignore");
        await fs.writeFile(testFile, "test");
        expect(await isHidden(testFile)).toBe(false);
      });
    }

    it("should handle root directory", async () => {
      expect(await isHidden(systemDrive())).toBe(false);
    });

    it("should return false on non-existent paths", async () => {
      const nonExistentPath = path.join(tempDir, "does-not-exist");
      await expect(await isHidden(nonExistentPath)).toBe(false);
    });
  });

  describe("isHiddenRecursive()", () => {
    it("should return true for nested hidden structure", async () => {
      const level1 = path.join(tempDir, "level1");
      await fs.mkdir(level1);

      let level2 = path.join(level1, "level2");
      await fs.mkdir(level2);
      level2 = (await setHidden(level2, true)).pathname;
      const level3 = path.join(level2, "level3");
      await fs.mkdir(level3);

      const testFile = path.join(level3, "file.txt");
      await fs.writeFile(testFile, "test");
      const expected = {
        testFile: true,
        level3: true,
        level2: true,
        level1: false,
        tempDir: false,
      };
      expect({
        testFile: await isHiddenRecursive(testFile),
        level3: await isHiddenRecursive(level3),
        level2: await isHiddenRecursive(level2),
        level1: await isHiddenRecursive(level1),
        tempDir: await isHiddenRecursive(tempDir),
      }).toEqual(expected);
    });

    it("should return false for root path", async () => {
      expect(await isHiddenRecursive("C:\\")).toBe(false);
    });
  });

  describe("setHidden", () => {
    it("should set file as hidden", async () => {
      const testFile = path.join(tempDir, "to-hide.txt");
      await fs.writeFile(testFile, "test");
      const expected = isWindows
        ? testFile
        : path.join(tempDir, ".to-hide.txt");

      expect(await setHidden(testFile, true)).toEqual(
        expect.objectContaining({
          pathname: expected,
        }),
      );
      expect(await isHidden(expected)).toBe(true);

      expect((await statAsync(expected)).isFile()).toBe(true);
    });

    it("should unhide hidden file", async () => {
      const testFile = path.join(tempDir, "to-unhide.txt");
      await fs.writeFile(testFile, "test");
      expect(await isHidden(testFile)).toBe(false);

      const expectedHidden = isWindows
        ? testFile
        : path.join(tempDir, ".to-unhide.txt");
      const hidden = (await setHidden(testFile, true)).pathname;

      expect(hidden).toEqual(expectedHidden);
      expect(await isHidden(hidden)).toBe(true);

      expect(await setHidden(testFile, false)).toEqual(
        expect.objectContaining({
          pathname: testFile,
        }),
      );
      expect(await isHidden(testFile)).toBe(false);
    });

    it("should set directory as hidden", async () => {
      const testSubDir = path.join(tempDir, "hide-me");
      const expected = isWindows ? testSubDir : path.join(tempDir, ".hide-me");
      await fs.mkdir(testSubDir);
      const hidden = (await setHidden(testSubDir, true)).pathname;
      expect(hidden).toEqual(expected);
      expect(await isHidden(hidden)).toBe(true);
      expect((await statAsync(hidden)).isDirectory()).toBe(true);
    });
  });

  describe("getHiddenMetadata()", () => {
    if (isWindows) {
      it("should return correct metadata for normal file on Windows", async () => {
        const testFile = path.join(tempDir, "normal.txt");
        await fs.writeFile(testFile, "test");

        const metadata = await getHiddenMetadata(testFile);
        expect(metadata).toEqual({
          hidden: false,
          dotPrefix: false,
          systemFlag: false,
          supported: {
            dotPrefix: false,
            systemFlag: true,
          },
        });
      });

      it("should return correct metadata for hidden file on Windows", async () => {
        const testFile = path.join(tempDir, "hidden.txt");
        await fs.writeFile(testFile, "test");
        execSync(`attrib +h "${testFile}"`);

        const metadata = await getHiddenMetadata(testFile);
        expect(metadata).toEqual({
          hidden: true,
          dotPrefix: false,
          systemFlag: true,
          supported: {
            dotPrefix: false,
            systemFlag: true,
          },
        });
      });

      it("should handle dot-prefixed files correctly on Windows", async () => {
        const testFile = path.join(tempDir, ".config");
        await fs.writeFile(testFile, "test");

        const metadata = await getHiddenMetadata(testFile);
        expect(metadata).toEqual({
          hidden: false,
          dotPrefix: false,
          systemFlag: false,
          supported: {
            dotPrefix: false,
            systemFlag: true,
          },
        });
      });
    } else {
      it("should return correct metadata for normal file on POSIX", async () => {
        const testFile = path.join(tempDir, "normal.txt");
        await fs.writeFile(testFile, "test");

        const metadata = await getHiddenMetadata(testFile);
        expect(metadata).toEqual({
          hidden: false,
          dotPrefix: false,
          systemFlag: false,
          supported: {
            dotPrefix: true,
            systemFlag: process.platform === "darwin",
          },
        });
      });

      it("should return correct metadata for dot-prefixed file on POSIX", async () => {
        const testFile = path.join(tempDir, ".hidden");
        await fs.writeFile(testFile, "test");

        const metadata = await getHiddenMetadata(testFile);
        expect(metadata).toEqual({
          hidden: true,
          dotPrefix: true,
          systemFlag: false,
          supported: {
            dotPrefix: true,
            systemFlag: process.platform === "darwin",
          },
        });
      });
    }

    it("should handle root directory", async () => {
      const metadata = await getHiddenMetadata(systemDrive());
      expect(metadata.hidden).toBe(false);
      expect(metadata.dotPrefix).toBe(false);
      if (isWindows) {
        expect(metadata.supported).toEqual({
          dotPrefix: false,
          systemFlag: true,
        });
      }
    });

    it("should handle non-existent paths", async () => {
      const nonExistentPath = path.join(tempDir, "does-not-exist");
      const metadata = await getHiddenMetadata(nonExistentPath);
      expect(metadata.hidden).toBe(false);
      expect(metadata.dotPrefix).toBe(false);
      expect(metadata.systemFlag).toBe(false);
    });
  });

  describe("setHidden method handling", () => {
    it("should respect method parameter", async () => {
      const testFile = path.join(tempDir, "method-test.txt");
      await fs.writeFile(testFile, "test");

      // Test explicit dotPrefix method
      const dotPrefixResult = await setHidden(testFile, true, "dotPrefix");

      expect(dotPrefixResult.actions).toEqual({
        dotPrefix: !isWindows, // true on POSIX, false on Windows
        systemFlag: false,
      });

      // Test explicit systemFlag method
      const systemFlagResult = await setHidden(testFile, true, "systemFlag");

      expect(systemFlagResult.actions).toEqual({
        dotPrefix: false,
        systemFlag: isWindows || process.platform === "darwin",
      });

      // Test "all" method
      const allResult = await setHidden(dotPrefixResult.pathname, true, "all");

      expect(allResult.pathname).toEqual(dotPrefixResult.pathname);

      if (isWindows) {
        expect(allResult.actions).toEqual({
          dotPrefix: false,
          systemFlag: true,
        });
      } else {
        expect(allResult.actions).toEqual({
          dotPrefix: false,
          systemFlag: process.platform === "darwin",
        });
      }
    });

    it("should handle 'auto' method correctly", async () => {
      const testFile = path.join(tempDir, "auto-test.txt");
      await fs.writeFile(testFile, "test");

      const result = await setHidden(testFile, true, "auto");

      if (isWindows) {
        expect(result.actions).toEqual({
          dotPrefix: false,
          systemFlag: true,
        });
      } else {
        expect(result.actions).toEqual({
          dotPrefix: true,
          systemFlag: false, // On POSIX, dotPrefix handles it so systemFlag isn't needed
        });
      }
    });

    it("should not apply systemFlag if already handled by dotPrefix in auto mode", async () => {
      if (!isWindows) {
        const testFile = path.join(tempDir, "already-handled.txt");
        await fs.writeFile(testFile, "test");

        const mockSetHidden = jest.fn();
        const result = await setHidden(testFile, true, "auto");

        expect(mockSetHidden).not.toHaveBeenCalled();
        expect(result.actions.dotPrefix).toBe(true);
        expect(result.actions.systemFlag).toBe(false);
      }
    });

    it("should apply both methods when hiding using 'all'", async () => {
      const testFile = path.join(tempDir, "all-methods.txt");
      await fs.writeFile(testFile, "test");
      const result = await setHidden(testFile, true, "all");
      expect(result).toEqual({
        pathname: LocalSupport.dotPrefix
          ? createHiddenPosixPath(testFile, true)
          : testFile,
        actions: LocalSupport,
      });
    });

    it("should apply both methods when unhiding using 'all'", async () => {
      const testFile = path.join(tempDir, ".all-methods.txt");
      await fs.writeFile(testFile, "test");
      const result = await setHidden(testFile, false, "all");
      expect(result).toEqual({
        pathname: LocalSupport.dotPrefix
          ? createHiddenPosixPath(testFile, false)
          : testFile,
        actions: LocalSupport,
      });
    });
  });
});
