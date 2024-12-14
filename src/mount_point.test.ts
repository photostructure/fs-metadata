// src/mount_point.test.ts

import { times, uniq } from "./array.js";
import { getVolumeMountPoints } from "./index.js";
import { MountPoint } from "./mount_point.js";
import { isLinux, isWindows } from "./platform.js";
import { sortByLocale } from "./string.js";

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
      const mountPoints = await getVolumeMountPoints();
      assertMountPoints(mountPoints);
    });

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
      it("should exclude pseudo filesystems", async () => {
        const mountPoints = await getVolumeMountPoints();
        const pseudoFS = isLinux
          ? ["/proc", "/sys", "/dev/pts"]
          : ["/dev", "/dev/fd"];

        pseudoFS.forEach((fs) => {
          expect(mountPoints).not.toContain(fs);
        });
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
