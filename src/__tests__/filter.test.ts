// src/__tests__/filter.test.ts

import { stat } from "node:fs/promises";
import {
  filterMountPoints,
  filterTypedMountPoints,
} from "../config_filters.js";

// Mock fs.promises.stat
jest.mock("node:fs/promises", () => ({
  stat: jest.fn(),
}));

const mockStat = stat as jest.MockedFunction<typeof stat>;

describe("filter", () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    // By default, make all paths exist
    mockStat.mockResolvedValue({} as any);
  });

  describe("filterMountPoints", () => {
    it("should filter out excluded mount points based on globs", async () => {
      const input = [
        "/",
        "/dev/sda1",
        "/home",
        "/proc/cpuinfo",
        "/run/lock",
        "/snap/core",
        "/sys/devices",
      ];

      const result = await filterMountPoints(input);

      // These should be filtered out based on defaults
      expect(result).not.toContain("/dev/sda1");
      expect(result).not.toContain("/proc/cpuinfo");
      expect(result).not.toContain("/sys/devices");
      expect(result).not.toContain("/run/lock");
      expect(result).not.toContain("/snap/core");

      // These should remain
      expect(result).toContain("/");
      expect(result).toContain("/home");
    });

    it("should handle empty input array", async () => {
      const result = await filterMountPoints([]);
      expect(result).toEqual([]);
    });

    it("should remove duplicates and sort results", async () => {
      const input = ["/home", "/", "/home", "/usr", "/"];
      const result = await filterMountPoints(input);
      expect(result).toEqual(["/", "/home", "/usr"]);
    });

    it("should respect custom options", async () => {
      const input = ["/", "/home", "/home/user", "/usr"];
      const result = await filterMountPoints(input, {
        excludedMountPointGlobs: ["/home/**"],
      });

      expect(result).toContain("/");
      expect(result).toContain("/usr");
      expect(result).not.toContain("/home/user");
    });

    it("should filter out non-existent paths", async () => {
      // Make some paths "not exist"
      mockStat.mockImplementation((path) => {
        if (path === "/nonexistent") {
          return Promise.reject(new Error("ENOENT"));
        }
        return Promise.resolve({} as any);
      });

      const input = ["/", "/nonexistent", "/home"];
      const result = await filterMountPoints(input);

      expect(result).not.toContain("/nonexistent");
      expect(result).toContain("/");
      expect(result).toContain("/home");
    });
  });

  describe("filterTypedMountPoints", () => {
    it("should filter based on both mount point globs and filesystem types", async () => {
      const input = [
        { mountPoint: "/", fstype: "ext4" },
        { mountPoint: "/proc", fstype: "proc" },
        { mountPoint: "/dev/pts", fstype: "devpts" },
        { mountPoint: "/home", fstype: "ext4" },
        { mountPoint: "/sys", fstype: "sysfs" },
      ];

      const result = await filterTypedMountPoints(input);
      const resultPoints = result.map((mp) => mp.mountPoint);

      expect(resultPoints).toContain("/");
      expect(resultPoints).toContain("/home");
      expect(resultPoints).not.toContain("/proc");
      expect(resultPoints).not.toContain("/dev/pts");
      expect(resultPoints).not.toContain("/sys");
    });

    it("should handle undefined mount points", async () => {
      const input = [
        { mountPoint: "/", fstype: "ext4" },
        undefined,
        { mountPoint: "/home", fstype: "ext4" },
      ];

      const result = await filterTypedMountPoints(input);

      expect(result).toContainEqual({ mountPoint: "/", fstype: "ext4" });
      expect(result).toContainEqual({ mountPoint: "/home", fstype: "ext4" });
      expect(result).toHaveLength(2);
    });

    it("should respect empty options", async () => {
      const input = [
        // These should all be filtered out by default
        { mountPoint: "/", fstype: "cgroup" },
        { mountPoint: "/dev", fstype: "ext4" },
      ];

      const result = await filterTypedMountPoints(input, {
        excludedFileSystemTypes: [],
        excludedMountPointGlobs: [],
      });
      expect(result).toEqual(input);
    });

    it("should remove duplicates based on mount point", async () => {
      const input = [
        { mountPoint: "/", fstype: "ext4" },
        { mountPoint: "/", fstype: "ext2" },
        { mountPoint: "/home", fstype: "ext4" },
      ];

      const result = await filterTypedMountPoints(input);
      expect(result).toEqual([
        { mountPoint: "/", fstype: "ext4" },
        { mountPoint: "/home", fstype: "ext4" },
      ]);
    });

    it("should sort results by mount point", async () => {
      const input = [
        { mountPoint: "/home", fstype: "ext4" },
        { mountPoint: "/", fstype: "ext4" },
        { mountPoint: "/usr", fstype: "ext4" },
      ];

      const result = await filterTypedMountPoints(input);
      expect(result).toEqual([
        { mountPoint: "/", fstype: "ext4" },
        { mountPoint: "/home", fstype: "ext4" },
        { mountPoint: "/usr", fstype: "ext4" },
      ]);
    });

    it("should handle custom options", async () => {
      const input = [
        { mountPoint: "/", fstype: "ext4" },
        { mountPoint: "/tmp", fstype: "tmpfs" },
        { mountPoint: "/mnt/usb", fstype: "ext4" },
      ];

      const result = await filterTypedMountPoints(input, {
        excludedFileSystemTypes: ["tmpfs"],
        excludedMountPointGlobs: ["/mnt/**"],
      });

      expect(result).toEqual([{ mountPoint: "/", fstype: "ext4" }]);
    });

    it("should filter out non-existent paths", async () => {
      const nonExistentPath = "/nonexistent";
      mockStat.mockImplementation((path) => {
        if (path === nonExistentPath) {
          return Promise.reject(new Error("ENOENT"));
        }
        return Promise.resolve({} as any);
      });

      const input = [
        { mountPoint: "/", fstype: "ext4" },
        { mountPoint: nonExistentPath, fstype: "ext4" },
        { mountPoint: "/home", fstype: "ext4" },
      ];

      const result = await filterTypedMountPoints(input);

      expect(result).toEqual([
        { mountPoint: "/", fstype: "ext4" },
        { mountPoint: "/home", fstype: "ext4" },
      ]);
    });
  });
});
