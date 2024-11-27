import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findAncestorDir } from "../fs.js";

describe("fs", () => {
  describe("findAncestorDir", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "findAncestorDir-tests-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

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
});
