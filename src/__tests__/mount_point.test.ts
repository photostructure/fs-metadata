import {
  normalizeLinuxMountPoint,
  normalizeWindowsMountPoint,
} from "../mount_point.js";

describe("mount_point", () => {
  describe("normalizeLinuxMountPoint", () => {
    it("removes trailing slash from regular paths", () => {
      expect(normalizeLinuxMountPoint("/home/")).toBe("/home");
      expect(normalizeLinuxMountPoint("/usr/local/")).toBe("/usr/local");
    });

    it("preserves root path", () => {
      expect(normalizeLinuxMountPoint("/")).toBe("/");
    });

    it("preserves paths without trailing slash", () => {
      expect(normalizeLinuxMountPoint("/home")).toBe("/home");
      expect(normalizeLinuxMountPoint("/usr/local")).toBe("/usr/local");
    });

    it("handles multiple trailing slashes", () => {
      expect(normalizeLinuxMountPoint("/home//")).toBe("/home");
      expect(normalizeLinuxMountPoint("/usr////")).toBe("/usr");
    });
  });

  describe("normalizeWindowsMountPoint", () => {
    it("adds backslash to bare drive letters", () => {
      expect(normalizeWindowsMountPoint("C:")).toBe("C:\\");
      expect(normalizeWindowsMountPoint("D:")).toBe("D:\\");
    });

    it("preserves paths that already have backslashes", () => {
      expect(normalizeWindowsMountPoint("C:\\")).toBe("C:\\");
      expect(normalizeWindowsMountPoint("D:\\path")).toBe("D:\\path");
    });

    it("handles UNC paths", () => {
      expect(normalizeWindowsMountPoint("\\\\server\\share")).toBe(
        "\\\\server\\share",
      );
    });

    it("preserves mixed case drive letters", () => {
      expect(normalizeWindowsMountPoint("c:")).toBe("C:\\");
      expect(normalizeWindowsMountPoint("C:")).toBe("C:\\");
    });
  });
});
