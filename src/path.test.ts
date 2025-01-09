// src/path.test.ts

import { normalizePosixPath, normalizeWindowsPath } from "./path.js";

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
});
