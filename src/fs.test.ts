// src/fs.test.ts

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import {
  canReaddir,
  canStatAsync,
  existsSync,
  findAncestorDir,
  isDirectory,
} from "./fs.js";

describe("fs", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "findAncestorDir-tests-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("canStatAsync", () => {
    it("should return true for existing file", async () => {
      const filePath = join(tempDir, "test.txt");
      await writeFile(filePath, "test content");
      expect(await canStatAsync(filePath)).toBe(true);
    });

    it("should return true for existing directory", async () => {
      expect(await canStatAsync(tempDir)).toBe(true);
    });

    it("should return false for non-existent path", async () => {
      const nonExistentPath = join(tempDir, "does-not-exist");
      expect(await canStatAsync(nonExistentPath)).toBe(false);
    });
  });

  describe("isDirectory", () => {
    it("should return true for directory", async () => {
      expect(await isDirectory(tempDir)).toBe(true);
    });

    it("should return false for file", async () => {
      const filePath = join(tempDir, "test.txt");
      await writeFile(filePath, "test content");

      const result = await isDirectory(filePath);
      expect(result).toBe(false);
    });

    it("should return false for non-existent path", async () => {
      const nonExistentPath = join(tempDir, "does-not-exist");
      expect(await isDirectory(nonExistentPath)).toBe(false);
    });

    it("should return true for unreadable dir", async () => {
      const unreadable = join(tempDir, "unreadable");
      await mkdir(unreadable, { mode: 0o000 });
      const child = join(unreadable, "child");
      expect(await isDirectory(unreadable)).toBe(true);
      expect(await isDirectory(child)).toBe(false);
    });
  });

  describe("existsSync", () => {
    it("should return true for existing file", async () => {
      const filePath = join(tempDir, "test.txt");
      await writeFile(filePath, "test content");

      expect(existsSync(filePath)).toBe(true);
    });

    it("should return true for existing directory", async () => {
      const dirPath = join(tempDir, "testDir");
      await mkdir(dirPath);

      expect(existsSync(dirPath)).toBe(true);
    });

    it("should return false for non-existent path", () => {
      const nonExistentPath = join(tempDir, "does-not-exist");

      expect(existsSync(nonExistentPath)).toBe(false);
    });
  });

  describe("findAncestorDir", () => {
    it("should return the directory containing the file", async () => {
      const dir1 = join(tempDir, "dir1");
      const dir2 = join(dir1, "dir2");
      const file = join(dir2, "file.txt");

      await mkdir(dir2, { recursive: true });
      await writeFile(file, "test");

      const result = await findAncestorDir(dir2, "file.txt");
      expect(result).toBe(dir2);
    });

    it("should return the ancestor directory containing the file", async () => {
      const dir1 = join(tempDir, "dir1");
      const dir2 = join(dir1, "dir2");
      const file = join(dir1, "file.txt");

      await mkdir(dir2, { recursive: true });
      await writeFile(file, "test");

      const result = await findAncestorDir(dir2, "file.txt");
      expect(result).toBe(dir1);
    });

    it("should return undefined if the file is not found", async () => {
      const dir1 = join(tempDir, "dir1");
      const dir2 = join(dir1, "dir2");

      await mkdir(dir2, { recursive: true });

      const result = await findAncestorDir(dir2, "file.txt");
      expect(result).toBeUndefined();
    });

    it("should return undefined if the directory is the root", async () => {
      const result = await findAncestorDir(tempDir, "file.txt");
      expect(result).toBeUndefined();
    });
  });

  describe("canReaddir", () => {
    it("should resolve for readable empty directory", async () => {
      const dirPath = join(tempDir, "emptyDir");
      await mkdir(dirPath);
      await expect(canReaddir(dirPath, 1000)).resolves.toBe(true);
    });

    it("should resolve for readable directory with readable content", async () => {
      const dirPath = join(tempDir, "readableDir");
      await mkdir(dirPath);
      await writeFile(join(dirPath, "test.txt"), "test");
      await expect(canReaddir(dirPath, 1000)).resolves.toBe(true);
    });

    it("should resolve for readable directory with unreadable content", async () => {
      const dirPath = join(tempDir, "readableDirWith000");
      await mkdir(dirPath);
      const txtPath = join(dirPath, "test.txt");
      // make txtPath unreadable
      await writeFile(txtPath, "test");
      await chmod(txtPath, 0o000);
      await expect(canReaddir(dirPath, 1000)).resolves.toBe(true);
    });

    (process.platform === "win32" || userInfo()?.uid === 0 ? it.skip : it)(
      "should reject for unreadable directory",
      async () => {
        const dirPath = join(tempDir, "unreadableDir");
        await mkdir(dirPath, { mode: 0o000 });
        expect(canReaddir(dirPath, 1000)).rejects.toThrow(/EACCES/);
      },
    );

    it("should reject for non-existent directory", async () => {
      const nonExistentPath = join(tempDir, "does-not-exist");
      await expect(canReaddir(nonExistentPath, 1000)).rejects.toThrow(/ENOENT/);
    });

    it("should reject for file path", async () => {
      const filePath = join(tempDir, "test.txt");
      await writeFile(filePath, "test");
      await expect(canReaddir(filePath, 1000)).rejects.toThrow(/ENOTDIR/);
    });

    it("should reject on timeout", async () => {
      const dirPath = join(tempDir, "timeoutDir");
      await mkdir(dirPath);

      await expect(canReaddir(dirPath, 1)).rejects.toThrow(/timeout/i);
    });
  });
});
