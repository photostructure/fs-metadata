// src/hidden.test.ts

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path, { join } from "node:path";
import { statAsync } from "./fs.js";
import { createHiddenPosixPath, LocalSupport } from "./hidden.js";
import {
  getHiddenMetadata,
  isHidden,
  isHiddenRecursive,
  setHidden,
} from "./index.js";
import { isLinux, isMacOS, isWindows } from "./platform.js";
import { validateHidden } from "./test-utils/hidden-tests.js";
import { systemDrive, tmpDirNotHidden } from "./test-utils/platform.js";

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
    describe("basic functionality", () => {
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

      it("should handle root directory", async () => {
        expect(await isHidden(systemDrive())).toBe(false);
      });

      it("should return false on non-existent paths", async () => {
        expect(await isHidden(path.join(tempDir, "does-not-exist"))).toBe(
          false,
        );
      });
    });

    describe("platform-specific behavior", () => {
      if (isWindows) {
        it("should detect hidden files using system flag", async () => {
          const testFile = path.join(tempDir, "hidden.txt");
          await fs.writeFile(testFile, "test");
          execSync(`attrib +h "${testFile}"`);
          expect(await isHidden(testFile)).toBe(true);
        });

        it("should detect hidden directories", async () => {
          const testDir = path.join(tempDir, "hiddenDir");
          await fs.mkdir(testDir);
          execSync(`attrib +h "${testDir}"`);
          expect(await isHidden(testDir)).toBe(true);
        });

        it("should not treat dot-prefixed files as hidden", async () => {
          const testFile = path.join(tempDir, ".gitignore");
          await fs.writeFile(testFile, "test");
          expect(await isHidden(testFile)).toBe(false);
        });
      } else {
        it("should detect hidden files by dot prefix", async () => {
          expect(await isHidden(path.join(tempDir, ".hidden.txt"))).toBe(true);
        });

        it("should detect hidden directories by dot prefix", async () => {
          const testDir = path.join(tempDir, ".hidden");
          await fs.mkdir(testDir, { recursive: true });
          expect(await isHidden(testDir)).toBe(true);
        });
      }
    });

    describe("special characters handling", () => {
      const testCases = [
        { type: "file", path: "hidden!@#.txt", isDir: false },
        { type: "directory", path: "hidden!@#", isDir: true },
      ];

      testCases.forEach(({ type, path: testPath, isDir }) => {
        it(`should handle hidden ${type} with special characters`, async () => {
          const fullPath = path.join(tempDir, testPath);
          if (isDir) {
            await fs.mkdir(fullPath);
          } else {
            await fs.writeFile(fullPath, "test");
          }
          const { pathname } = await setHidden(fullPath, true);
          expect(await isHidden(pathname)).toBe(true);
        });
      });

      it("should handle hidden items in nested directories", async () => {
        const nestedDir = path.join(tempDir, "nested", "dir");
        await fs.mkdir(nestedDir, { recursive: true });

        // Test both file and directory
        const testFile = path.join(nestedDir, "hidden.txt");
        const testDir = path.join(nestedDir, "hidden");

        await fs.writeFile(testFile, "test");
        await fs.mkdir(testDir);

        const hiddenFile = await setHidden(testFile, true);
        const hiddenDir = await setHidden(testDir, true);

        expect(await isHidden(hiddenFile.pathname)).toBe(true);
        expect(await isHidden(hiddenDir.pathname)).toBe(true);
      });
    });
  });

  describe("isHiddenRecursive()", () => {
    it("should handle nested hidden structure", async () => {
      // Create nested structure
      const level1 = path.join(tempDir, "level1");
      await fs.mkdir(level1);

      let level2 = path.join(level1, "level2");
      await fs.mkdir(level2);
      level2 = (await setHidden(level2, true)).pathname;

      const level3 = path.join(level2, "level3");
      await fs.mkdir(level3);

      const testFile = path.join(level3, "file.txt");
      await fs.writeFile(testFile, "test");

      // Verify recursive hidden status
      expect({
        testFile: await isHiddenRecursive(testFile),
        level3: await isHiddenRecursive(level3),
        level2: await isHiddenRecursive(level2),
        level1: await isHiddenRecursive(level1),
        tempDir: await isHiddenRecursive(tempDir),
      }).toEqual({
        testFile: true,
        level3: true,
        level2: true,
        level1: false,
        tempDir: false,
      });
    });

    it("should return false for root path", async () => {
      expect(await isHiddenRecursive(isWindows ? "C:\\" : "/")).toBe(false);
    });

    it("should handle special characters in paths", async () => {
      const nestedDir = path.join(tempDir, "nested", "dir");
      await fs.mkdir(nestedDir, { recursive: true });

      const testDir = path.join(nestedDir, "hidden!@#");
      await fs.mkdir(testDir);
      const hidden = await setHidden(testDir, true);

      // Test directory and file within it
      expect(await isHiddenRecursive(hidden.pathname)).toBe(true);
      const testFile = path.join(hidden.pathname, "file!@#.txt");
      await fs.writeFile(testFile, "test");
      expect(await isHiddenRecursive(testFile)).toBe(true);
    });
  });

  describe("setHidden()", () => {
    describe("basic functionality", () => {
      it("should set and unset hidden attribute", async () => {
        const testFile = path.join(tempDir, "to-hide.txt");
        await fs.writeFile(testFile, "test");

        const expectedHidden = isWindows
          ? testFile
          : path.join(tempDir, ".to-hide.txt");
        const hidden = await setHidden(testFile, true);

        expect(hidden.pathname).toEqual(expectedHidden);
        expect(await isHidden(expectedHidden)).toBe(true);
        expect((await statAsync(expectedHidden)).isFile()).toBe(true);

        const unhidden = await setHidden(hidden.pathname, false);
        expect(unhidden.pathname).toEqual(testFile);
        expect(await isHidden(testFile)).toBe(false);
      });

      it("should set directory as hidden", async () => {
        const testDir = path.join(tempDir, "hide-me");
        const expected = isWindows ? testDir : path.join(tempDir, ".hide-me");
        await fs.mkdir(testDir);

        const hidden = await setHidden(testDir, true);
        expect(hidden.pathname).toEqual(expected);
        expect(await isHidden(expected)).toBe(true);
        expect((await statAsync(expected)).isDirectory()).toBe(true);
      });
    });

    describe("platform-specific behavior", () => {
      if (isWindows) {
        const methods = ["systemFlag", "all", "auto"] as const;
        for (const method of methods) {
          it(`should prevent hiding Windows root with ${method} method`, async () => {
            await expect(setHidden("C:\\", true, method)).rejects.toThrow(
              "Cannot hide root directory on Windows",
            );
          });
        }
      }

      if (isLinux) {
        it("should reject systemFlag method", async () => {
          const testFile = path.join(tempDir, "linux-error-test.txt");
          await fs.writeFile(testFile, "test");
          await expect(setHidden(testFile, true, "systemFlag")).rejects.toThrow(
            /not supported/i,
          );
        });
      }

      if (!isWindows) {
        it("should handle multiple dot prefixes", async () => {
          const testFile = path.join(tempDir, ".already-hidden.txt");
          await fs.writeFile(testFile, "test");

          const result = await setHidden(testFile, true, "dotPrefix");
          expect(result.pathname).toEqual(
            path.join(tempDir, ".already-hidden.txt"),
          );
          expect(result.actions).toEqual({
            dotPrefix: false,
            systemFlag: false,
          });
        });

        it("should handle dots in middle of filename", async () => {
          const testFile = path.join(tempDir, "file.with.dots.txt");
          await fs.writeFile(testFile, "test");

          const result = await setHidden(testFile, true, "dotPrefix");
          expect(result.pathname).toEqual(
            path.join(tempDir, ".file.with.dots.txt"),
          );
          expect(result.actions).toEqual({
            dotPrefix: true,
            systemFlag: false,
          });
        });
      }
    });

    describe("special characters handling", () => {
      const testCases = [
        { type: "file", path: "special!@#.txt", isDir: false },
        { type: "directory", path: "special!@#", isDir: true },
      ];

      testCases.forEach(({ type, path: testPath, isDir }) => {
        it(`should handle hiding and unhiding ${type} with special characters`, async () => {
          const fullPath = path.join(tempDir, testPath);
          if (isDir) {
            await fs.mkdir(fullPath);
          } else {
            await fs.writeFile(fullPath, "test");
          }

          const hidden = await setHidden(fullPath, true);
          expect(await isHidden(hidden.pathname)).toBe(true);

          const unhidden = await setHidden(hidden.pathname, false);
          expect(await isHidden(unhidden.pathname)).toBe(false);
        });
      });
    });

    describe("method handling", () => {
      it("should handle 'all' method", async () => {
        const testFile = path.join(tempDir, "all-test.txt");
        await fs.writeFile(testFile, "test");

        const hideResult = await setHidden(testFile, true, "all");
        expect(hideResult).toEqual({
          pathname: LocalSupport.dotPrefix
            ? createHiddenPosixPath(testFile, true)
            : testFile,
          actions: LocalSupport,
        });

        const unhideResult = await setHidden(hideResult.pathname, false, "all");
        expect(unhideResult).toEqual({
          pathname: testFile,
          actions: LocalSupport,
        });
      });

      it("should handle 'auto' method", async () => {
        const testFile = path.join(tempDir, "auto-test.txt");
        await fs.writeFile(testFile, "test");

        const hideResult = await setHidden(testFile, true, "auto");
        expect(hideResult).toEqual({
          pathname: LocalSupport.dotPrefix
            ? createHiddenPosixPath(testFile, true)
            : testFile,
          actions: {
            dotPrefix: LocalSupport.dotPrefix,
            systemFlag: !LocalSupport.dotPrefix,
          },
        });

        const unhideResult = await setHidden(
          hideResult.pathname,
          false,
          "auto",
        );
        expect(unhideResult).toEqual({
          pathname: testFile,
          actions: {
            dotPrefix: LocalSupport.dotPrefix,
            systemFlag: !LocalSupport.dotPrefix,
          },
        });
      });

      if (!LocalSupport.dotPrefix) {
        it("should reject unsupported dotPrefix method", async () => {
          await expect(
            setHidden(path.join(tempDir, "test.txt"), true, "dotPrefix"),
          ).rejects.toThrow(/not supported/);
        });
      }

      if (!LocalSupport.systemFlag) {
        it("should reject unsupported systemFlag method", async () => {
          await expect(
            setHidden(path.join(tempDir, "test.txt"), true, "systemFlag"),
          ).rejects.toThrow(/not supported/);
        });
      }
    });
  });

  describe("getHiddenMetadata()", () => {
    describe("platform-specific behavior", () => {
      if (isWindows) {
        it("should return correct metadata for normal file", async () => {
          const testFile = path.join(tempDir, "normal.txt");
          await fs.writeFile(testFile, "test");

          expect(await getHiddenMetadata(testFile)).toEqual({
            hidden: false,
            dotPrefix: false,
            systemFlag: false,
            supported: {
              dotPrefix: false,
              systemFlag: true,
            },
          });
        });

        it("should return correct metadata for hidden file", async () => {
          const testFile = path.join(tempDir, "hidden.txt");
          await fs.writeFile(testFile, "test");
          execSync(`attrib +h "${testFile}"`);

          expect(await getHiddenMetadata(testFile)).toEqual({
            hidden: true,
            dotPrefix: false,
            systemFlag: true,
            supported: {
              dotPrefix: false,
              systemFlag: true,
            },
          });
        });

        it("should handle dot-prefixed files correctly", async () => {
          const testFile = path.join(tempDir, ".config");
          await fs.writeFile(testFile, "test");

          expect(await getHiddenMetadata(testFile)).toEqual({
            hidden: false,
            dotPrefix: false,
            systemFlag: false,
            supported: {
              dotPrefix: false,
              systemFlag: true,
            },
          });
        });
      }

      if (isMacOS) {
        it("should return systemFlagged for a known system directory", async () => {
          const result = await getHiddenMetadata(join(homedir(), "Library"));
          expect(result).toEqual({
            hidden: true,
            dotPrefix: false,
            systemFlag: true,
            supported: LocalSupport,
          });
        });
      }

      if (!isWindows) {
        it("should return correct metadata for normal file", async () => {
          const testFile = path.join(tempDir, "normal.txt");
          await fs.writeFile(testFile, "test");

          expect(await getHiddenMetadata(testFile)).toEqual({
            hidden: false,
            dotPrefix: false,
            systemFlag: false,
            supported: {
              dotPrefix: true,
              systemFlag: process.platform === "darwin",
            },
          });
        });

        it("should return correct metadata for dot-prefixed file", async () => {
          const testFile = path.join(tempDir, ".hidden");
          await fs.writeFile(testFile, "test");

          expect(await getHiddenMetadata(testFile)).toEqual({
            hidden: true,
            dotPrefix: true,
            systemFlag: false,
            supported: LocalSupport,
          });
        });
      }
    });

    describe("edge cases", () => {
      it("should handle root directory", async () => {
        expect(await getHiddenMetadata(systemDrive())).toEqual({
          hidden: false,
          dotPrefix: false,
          systemFlag: false,
          supported: LocalSupport,
        });
      });

      it("should handle non-existent paths", async () => {
        expect(
          await getHiddenMetadata(path.join(tempDir, "does-not-exist")),
        ).toEqual({
          hidden: false,
          dotPrefix: false,
          systemFlag: false,
          supported: LocalSupport,
        });
      });
    });

    describe("special characters handling", () => {
      for (const { type, path: testPath, isDir } of [
        { type: "file", path: "special!@#.txt", isDir: false },
        { type: "directory", path: "special!@#", isDir: true },
      ]) {
        it(`should return correct metadata for ${type} with special characters`, async () => {
          const fullPath = path.join(tempDir, testPath);
          if (isDir) {
            await fs.mkdir(fullPath);
          } else {
            await fs.writeFile(fullPath, "test");
          }

          const { pathname } = await setHidden(fullPath, true);
          const metadata = await getHiddenMetadata(pathname);
          expect(metadata.hidden).toBe(true);
          expect(metadata.supported).toEqual(LocalSupport);
        });
      }
    });
  });
});