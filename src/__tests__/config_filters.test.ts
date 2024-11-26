// src/__tests__/config_filters.test.ts

import { jest } from "@jest/globals";
import { Stats } from "node:fs";
import { env } from "node:process";
import { times } from "../array.js";
import {
  filterMountPoints,
  filterTypedMountPoints,
} from "../config_filters.js";
import { normalizePath } from "../path.js";
import { isWindows } from "../platform.js";
import { shuffle } from "../random.js";
import { sortByLocale } from "../string.js";

const mockStatAsync = jest.fn();

jest.mock("../fs_promises.js", () => ({
  statAsync: mockStatAsync,
}));

const MockDirectoryStatResult = {
  isDirectory: () => true,
} as Stats;

// Import the mocked wrapper module
const NonExistentPath = isWindows ? "A:\\" : "/nonexistent";
const ExistingPaths = sortByLocale(
  (isWindows ? [env["SystemDrive"]!] : ["/", "/home", "/usr"]).map(
    normalizePath,
  ),
);

const DefaultFsType = isWindows ? "ntfs" : "ext4";

const ExistingTypedMountPoints = ExistingPaths.map((mountPoint) => ({
  mountPoint,
  fstype: DefaultFsType,
}));

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
        ...ExistingPaths,
        "/dev/sda1",
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
      for (const path of ExistingPaths) {
        expect(result).toContain(path);
      }
    });

    it("should handle empty input array", async () => {
      const result = await filterMountPoints([]);
      expect(result).toEqual([]);
    });

    it("should remove duplicates and sort results", async () => {
      const input = times(3, () => shuffle(ExistingPaths)).flat();
      const result = await filterMountPoints(input);
      expect(result).toEqual(ExistingPaths);
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
      expect(
        await filterMountPoints([NonExistentPath, ...ExistingPaths]),
      ).toEqual(ExistingPaths);
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
      const input = [...ExistingTypedMountPoints, undefined];
      const result = await filterTypedMountPoints(input);
      expect(result).toEqual(ExistingPaths);
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

    it("should sort and deduplicate based on mount point", async () => {
      const input = [
        ...shuffle(ExistingTypedMountPoints),
        ...ExistingTypedMountPoints,
      ];
      const result = await filterTypedMountPoints(input, { onlyDirectories });
      expect(result).toEqual(ExistingPaths);
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
        await filterTypedMountPoints([
          ...ExistingTypedMountPoints,
          { mountPoint: NonExistentPath, fstype: DefaultFsType },
        ]),
      ).toEqual(ExistingPaths);
    });
  });
});
