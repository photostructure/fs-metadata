import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { statAsync } from "../fs_promises.js";
import { isHidden, isHiddenRecursive, setHidden } from "../index.js";
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
      level2 = await setHidden(level2, true);
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

      expect(await setHidden(testFile, true)).toEqual(expected);
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
      const hidden = await setHidden(testFile, true);

      expect(hidden).toEqual(expectedHidden);
      expect(await isHidden(hidden)).toBe(true);

      expect(await setHidden(testFile, false)).toEqual(testFile);
      expect(await isHidden(testFile)).toBe(false);
    });

    it("should set directory as hidden", async () => {
      const testSubDir = path.join(tempDir, "hide-me");
      const expected = isWindows ? testSubDir : path.join(tempDir, ".hide-me");
      await fs.mkdir(testSubDir);
      const hidden = await setHidden(testSubDir, true);
      expect(hidden).toEqual(expected);
      expect(await isHidden(hidden)).toBe(true);
      expect((await statAsync(hidden)).isDirectory()).toBe(true);
    });
  });
});
