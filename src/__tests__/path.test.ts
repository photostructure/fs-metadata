import { normalizeLinuxPath, normalizeWindowsPath } from "../path.js";

describe("mount_point", () => {
  describe("normalizeLinuxPath", () => {
    it("removes trailing slash from regular paths", () => {
      expect(normalizeLinuxPath("/home/")).toBe("/home");
      expect(normalizeLinuxPath("/usr/local/")).toBe("/usr/local");
    });

    it("preserves root path", () => {
      expect(normalizeLinuxPath("/")).toBe("/");
    });

    it("preserves paths without trailing slash", () => {
      expect(normalizeLinuxPath("/home")).toBe("/home");
      expect(normalizeLinuxPath("/usr/local")).toBe("/usr/local");
    });

    it("handles multiple trailing slashes", () => {
      expect(normalizeLinuxPath("/home//")).toBe("/home");
      expect(normalizeLinuxPath("/usr////")).toBe("/usr");
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
