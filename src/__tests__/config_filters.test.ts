// src/__tests__/config_filters.test.ts

import { jest } from "@jest/globals";
import { Stats } from "node:fs";
import {
  filterMountPoints,
  filterTypedMountPoints,
} from "../config_filters.js";
import { isWindows } from "../platform.js";

const mockStatAsync = jest.fn();

jest.mock("../fs_promises.js", () => ({
  statAsync: mockStatAsync,
}));

const MockDirectoryStatResult = {
  isDirectory: () => true,
} as Stats;

// Import the mocked wrapper module
const NonExistentPath = "/nonexistent";

describe("config_filters", () => {
  // We want to validate onlyDirectories if we're NOT windows.
  const onlyDirectories = !isWindows;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    // By default, make all paths exist
    mockStatAsync.mockImplementation((path) => {
      return path === NonExistentPath
        ? Promise.reject(new Error("ENOENT"))
        : Promise.resolve(MockDirectoryStatResult);
    });
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

      const result = await filterMountPoints(input, { onlyDirectories });

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
      const result = await filterMountPoints(input, { onlyDirectories });
      expect(result).toEqual(["/", "/home", "/usr"]);
    });

    it("should respect custom options", async () => {
      const input = ["/", "/home", "/home/user", "/usr"];
      const result = await filterMountPoints(input, {
        excludedMountPointGlobs: ["/home/**"],
        onlyDirectories,
      });

      expect(result).toContain("/");
      expect(result).toContain("/usr");
      expect(result).not.toContain("/home/user");
    });

    it("should filter out non-existent paths", async () => {
      // Make some paths "not exist"
      const input = ["/", "/home", NonExistentPath];
      expect(await filterMountPoints(input)).toEqual(["/", "/home"]);
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

      const resultPoints = await filterTypedMountPoints(input, {
        onlyDirectories,
      });

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

      const result = await filterTypedMountPoints(input, { onlyDirectories });

      expect(result).toEqual(["/", "/home"]);
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
        onlyDirectories,
      });
      expect(result).toEqual(input.map((ea) => ea.mountPoint));
    });

    it("should remove duplicates based on mount point", async () => {
      const input = [
        { mountPoint: "/", fstype: "ext4" },
        { mountPoint: "/", fstype: "ext2" },
        { mountPoint: "/home", fstype: "ext4" },
      ];

      const result = await filterTypedMountPoints(input, { onlyDirectories });
      expect(result).toEqual(["/", "/home"]);
    });

    it("should sort results by mount point", async () => {
      const input = [
        { mountPoint: "/home", fstype: "ext4" },
        { mountPoint: "/", fstype: "ext4" },
        { mountPoint: "/usr", fstype: "ext4" },
      ];

      const result = await filterTypedMountPoints(input, {
        onlyDirectories,
      });
      expect(result).toEqual(["/", "/home", "/usr"]);
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
        onlyDirectories,
      });

      expect(result).toEqual(["/"]);
    });

    it("should filter out non-existent paths", async () => {
      expect(
        await filterTypedMountPoints(
          [
            { mountPoint: "/", fstype: "ext4" },
            { mountPoint: NonExistentPath, fstype: "ext4" },
            { mountPoint: "/home", fstype: "ext4" },
          ],
          { onlyDirectories },
        ),
      ).toEqual(["/", "/home"]);
    });
  });
});
