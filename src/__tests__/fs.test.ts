import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canReaddir,
  canStatAsync,
  existsSync,
  findAncestorDir,
  isDirectory,
} from "../fs.js";

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

      const result = await canStatAsync(filePath);
      expect(result).toBe(true);
    });

    it("should return true for existing directory", async () => {
      const dirPath = join(tempDir, "testDir");
      await mkdir(dirPath);

      const result = await canStatAsync(dirPath);
      expect(result).toBe(true);
    });

    it("should return false for non-existent path", async () => {
      const nonExistentPath = join(tempDir, "does-not-exist");

      const result = await canStatAsync(nonExistentPath);
      expect(result).toBe(false);
    });
  });

  describe("isDirectory", () => {
    it("should return true for directory", async () => {
      const dirPath = join(tempDir, "testDir");
      await mkdir(dirPath);

      const result = await isDirectory(dirPath);
      expect(result).toBe(true);
    });

    it("should return false for file", async () => {
      const filePath = join(tempDir, "test.txt");
      await writeFile(filePath, "test content");

      const result = await isDirectory(filePath);
      expect(result).toBe(false);
    });

    it("should return false for non-existent path", async () => {
      const nonExistentPath = join(tempDir, "does-not-exist");

      const result = await isDirectory(nonExistentPath);
      expect(result).toBe(false);
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
    it("should resolve for readable directory", async () => {
      const dirPath = join(tempDir, "readableDir");
      await mkdir(dirPath);
      await writeFile(join(dirPath, "test.txt"), "test");

      await expect(canReaddir(dirPath, 1000)).resolves.toBeUndefined();
    });

    it("should reject for non-existent directory", async () => {
      const nonExistentPath = join(tempDir, "does-not-exist");

      await expect(canReaddir(nonExistentPath, 1000)).rejects.toThrow();
    });

    it("should reject for file path", async () => {
      const filePath = join(tempDir, "test.txt");
      await writeFile(filePath, "test");

      await expect(canReaddir(filePath, 1000)).rejects.toThrow();
    });

    it("should reject on timeout", async () => {
      const dirPath = join(tempDir, "timeoutDir");
      await mkdir(dirPath);

      await expect(canReaddir(dirPath, 1)).rejects.toThrow(/timeout/i);
    });
  });
});
