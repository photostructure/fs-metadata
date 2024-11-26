import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { isHidden, isHiddenRecursive, setHidden } from "../index.js";
import { isWindows } from "../platform.js";
import { tmpDirNotHidden } from "../test-utils/platform.js";

if (isWindows)
  describe("Windows-only hidden file tests", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(tmpDirNotHidden(), "hidden-tests-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe("isHidden()", () => {
      it("should detect hidden files", async () => {
        const testFile = path.join(tempDir, "hidden.txt");
        await fs.writeFile(testFile, "test");
        await execSync(`attrib +h "${testFile}"`);

        expect(await isHidden(testFile)).toBe(true);
      });

      it("should not detect normal files as hidden", async () => {
        const testFile = path.join(tempDir, "normal.txt");
        await fs.writeFile(testFile, "test");

        expect(await isHidden(testFile)).toBe(false);
      });

      it("should detect hidden directories", async () => {
        const testDir = path.join(tempDir, "hiddenDir");
        await fs.mkdir(testDir);
        await execSync(`attrib +h "${testDir}"`);

        expect(await isHidden(testDir)).toBe(true);
      });

      it("should not treat dot-prefixed files as hidden", async () => {
        const testFile = path.join(tempDir, ".gitignore");
        await fs.writeFile(testFile, "test");

        expect(await isHidden(testFile)).toBe(false);
      });

      it("should handle root directory", async () => {
        expect(await isHidden("C:\\")).toBe(false);
      });

      it("should throw on non-existent paths", async () => {
        const nonExistentPath = path.join(tempDir, "does-not-exist");
        await expect(isHidden(nonExistentPath)).rejects.toThrow();
      });
    });

    describe("isHiddenRecursive()", () => {
      it("should return true for nested hidden structure", async () => {
        const level1 = path.join(tempDir, "level1");
        const level2 = path.join(level1, "level2");
        const level3 = path.join(level2, "level3");

        await fs.mkdir(level1);
        await fs.mkdir(level2);
        await fs.mkdir(level3);
        await setHidden(level2, true);

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

        expect(await setHidden(testFile, true)).toEqual(testFile);
        expect(await isHidden(testFile)).toBe(true);
      });

      it("should unhide hidden file", async () => {
        const testFile = path.join(tempDir, "to-unhide.txt");
        await fs.writeFile(testFile, "test");
        expect(await isHidden(testFile)).toBe(false);

        expect(await setHidden(testFile, true)).toEqual(testFile);
        expect(await setHidden(testFile, false)).toEqual(testFile);
        expect(await isHidden(testFile)).toBe(false);
      });

      it("should set directory as hidden", async () => {
        const testSubDir = path.join(tempDir, "hide-me");
        await fs.mkdir(testSubDir);
        expect(await setHidden(testSubDir, true)).toEqual(testSubDir);
        expect(await isHidden(testSubDir)).toBe(true);
      });
    });
  });
