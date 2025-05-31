// src/mount_point.test.ts

import { jest } from "@jest/globals";
import { times, uniq } from "./array";
import { getVolumeMountPoints } from "./index";
import { isWindows } from "./platform";
import { sortByLocale } from "./string";
import type { MountPoint } from "./types/mount_point";

describe("Filesystem Metadata", () => {
  jest.setTimeout(15_000);

  describe("Mount Points", () => {
    function assertMountPoints(arr: MountPoint[]) {
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBeGreaterThan(0);

      const mountPoints = arr.map((ea) => ea.mountPoint);
      // Platform-specific root checks
      if (isWindows) {
        expect(mountPoints).toContain("C:\\");
      } else {
        expect(mountPoints).toContain("/");
      }
    }

    it("should list mount points without errors", async () => {
      assertMountPoints(await getVolumeMountPoints());
    });

    if (!isWindows) {
      // < timeouts on windows are handled by the native bindings, and don't know about the magick "timeoutMs = 1" test option.
      it("should timeout mount points if timeoutMs = 1", async () => {
        await expect(getVolumeMountPoints({ timeoutMs: 1 })).rejects.toThrow(
          /timeout/i, // < we can't check for instanceOf TimeoutError because it's imported from the tsup bundle
        );
      });
    }

    it("should handle concurrent mountPoint requests", async () => {
      const expected = await getVolumeMountPoints();
      assertMountPoints(expected);
      for (const ea of await Promise.all(
        times(8, () => getVolumeMountPoints()),
      )) {
        expect(ea).toEqual(expected);
      }
    });

    if (!isWindows) {
      it("should mark filesystems properly as a system volume", async () => {
        const allMountPoints = await getVolumeMountPoints({
          includeSystemVolumes: true,
        });
        const nonSystemMountPoints = await getVolumeMountPoints();
        console.log({ allMountPoints, nonSystemMountPoints });
        const foundSystemVolumes = [];
        const mismarkedSystemVolumes = [];
        const systemVolumesInDefaultList = nonSystemMountPoints.filter(
          (ea) => ea.isSystemVolume,
        );
        // this is a non-exhaustive list of filesystems to validate that at
        // least one of these both exists and is marked as a system volume:
        for (const mountPoint of [
          "/boot",
          "/proc",
          "/sys",
          "/dev/shm",
          "/snap",
          "/run/lock",
          "/System/Volumes/VM",
        ]) {
          const fs = allMountPoints.find((ea) => ea.mountPoint === mountPoint);
          if (fs != null) {
            if (fs.isSystemVolume) {
              foundSystemVolumes.push(fs);
            } else {
              mismarkedSystemVolumes.push(fs);
            }
          }
          systemVolumesInDefaultList.push(
            ...systemVolumesInDefaultList.filter(
              (ea) => ea.mountPoint === mountPoint,
            ),
          );
        }
        expect(foundSystemVolumes).not.toEqual([]);
        expect(mismarkedSystemVolumes).toEqual([]);
        expect(systemVolumesInDefaultList).toEqual([]);
      });
    }

    it("should return unique, sorted mount points", async () => {
      const arr = await getVolumeMountPoints();
      const mountPoints = arr.map((ea) => ea.mountPoint);
      const sorted = uniq(sortByLocale([...mountPoints]));
      expect(mountPoints).toEqual(sorted);
    });
  });
});
