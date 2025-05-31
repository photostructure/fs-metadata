// src/path.test.ts

import {
  isRootDirectory,
  normalizePath,
  normalizePosixPath,
  normalizeWindowsPath,
} from "./path";
import { isWindows } from "./platform";

describe("mount_point", () => {
  describe("normalizeLinuxPath", () => {
    it("removes trailing slash from regular paths", () => {
      expect(normalizePosixPath("/home/")).toBe("/home");
      expect(normalizePosixPath("/usr/local/")).toBe("/usr/local");
    });

    it("preserves root path", () => {
      expect(normalizePosixPath("/")).toBe("/");
    });

    it("preserves paths without trailing slash", () => {
      expect(normalizePosixPath("/home")).toBe("/home");
      expect(normalizePosixPath("/usr/local")).toBe("/usr/local");
    });

    it("handles multiple trailing slashes", () => {
      expect(normalizePosixPath("//")).toBe("/");
      expect(normalizePosixPath("/home//")).toBe("/home");
      expect(normalizePosixPath("/usr////")).toBe("/usr");
    });

    it("handles undefined and blank inputs", () => {
      expect(normalizePosixPath(undefined)).toBe(undefined);
      expect(normalizePosixPath("")).toBe(undefined);
      expect(normalizePosixPath("   ")).toBe(undefined);
    });
  });

  describe("normalizeWindowsPath", () => {
    it("adds backslash to bare drive letters", () => {
      expect(normalizeWindowsPath("C:")).toBe("C:\\");
      expect(normalizeWindowsPath("D:")).toBe("D:\\");
    });

    it("preserves paths that already have backslashes", () => {
      expect(normalizeWindowsPath("C:\\")).toBe("C:\\");
      expect(normalizeWindowsPath("D:\\path")).toBe("D:\\path");
    });

    it("handles UNC paths", () => {
      expect(normalizeWindowsPath("\\\\server\\share")).toBe(
        "\\\\server\\share",
      );
    });

    it("preserves mixed case drive letters", () => {
      expect(normalizeWindowsPath("c:")).toBe("C:\\");
      expect(normalizeWindowsPath("C:")).toBe("C:\\");
    });
  });

  describe("normalizePath", () => {
    it("handles undefined and blank inputs", () => {
      expect(normalizePath(undefined)).toBe(undefined);
      expect(normalizePath("")).toBe(undefined);
      expect(normalizePath("   ")).toBe(undefined);
    });

    it("normalizes paths based on platform", () => {
      if (isWindows) {
        const result = normalizePath("C:");
        expect(result).toMatch(/^C:\\/);
      } else {
        const result = normalizePath("/home/");
        expect(result).toMatch(/^\/home$/);
      }
    });
  });

  describe("isRootDirectory", () => {
    it("correctly identifies root directories", () => {
      if (isWindows) {
        expect(isRootDirectory("C:\\")).toBe(true);
        expect(isRootDirectory("D:\\")).toBe(true);
        expect(isRootDirectory("C:\\Windows")).toBe(false);
      } else {
        expect(isRootDirectory("/")).toBe(true);
        expect(isRootDirectory("/home")).toBe(false);
        expect(isRootDirectory("/usr/")).toBe(false);
      }
    });

    it("handles invalid paths", () => {
      expect(isRootDirectory("")).toBe(false);
      expect(isRootDirectory("   ")).toBe(false);
    });
  });
});
