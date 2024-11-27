// src/__tests__/fs_metadata.test.ts

import { jest } from "@jest/globals";
import { times } from "../array.js";
import { TimeoutError } from "../async.js";
import {
  getAllVolumeMetadata,
  getVolumeMetadata,
  getVolumeMountPoints,
} from "../index.js";
import { omit } from "../object.js";
import { isLinux, isMacOS, isWindows } from "../platform.js";
import { pickRandom, randomLetter, randomLetters, shuffle } from "../random.js";
import { sortByLocale } from "../string.js";
import { assertMetadata } from "../test-utils/assert.js";
import { MiB } from "../units.js";

describe("Filesystem Metadata", () => {
  jest.setTimeout(15_000);

  describe("Mount Points", () => {
    function assertMountPoints(mountPoints: string[]) {
      expect(Array.isArray(mountPoints)).toBe(true);
      expect(mountPoints.length).toBeGreaterThan(0);

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
      for (const ea of await Promise.all(times(8, getVolumeMountPoints))) {
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

    it("should return sorted mount points", async () => {
      const mountPoints = await getVolumeMountPoints();
      const sorted = sortByLocale(mountPoints);
      expect(mountPoints).toEqual(sorted);
    });
  });

  describe("Volume Metadata", () => {
    it("should get root filesystem metadata", async () => {
      const rootPath = isWindows ? "C:\\" : "/";
      const metadata = await getVolumeMetadata(rootPath);

      console.dir(metadata);

      expect(metadata.mountPoint).toBe(rootPath);
      assertMetadata(metadata);

      // Platform-specific filesystem checks
      if (isWindows) {
        expect(metadata.fileSystem).toMatch(/^(ntfs|refs)$/i);
      } else if (isMacOS) {
        expect(metadata.fileSystem).toMatch(/^(apfs|hfs)$/i);
      } else if (isLinux) {
        // We expect "overlay" for Docker containers
        expect(metadata.fileSystem).toMatch(
          /^(ext[234]|xfs|btrfs|zfs|overlay)$/i,
        );
      }
    });

    it("handles non-existant mount points (from native)", async () => {
      expect(
        getVolumeMetadata("/nonexistent", {
          onlyDirectories: false,
        }),
      ).rejects.toThrow(
        isWindows
          ? /ENOENT: no such file or directory/
          : /statvfs|Failed to get volume (statistics|information)/,
      );
    });

    it("handles non-existant mount points (from js)", async () => {
      expect(getVolumeMetadata("/nonexistent")).rejects.toThrow(
        /mountPoint .+ is not accessible:/,
      );
    });

    it("should handle concurrent getVolumeMetadata() calls", async () => {
      const mountPoints = await getVolumeMountPoints();
      const expectedMountPoint = mountPoints[0]!;
      const expected = await getVolumeMetadata(expectedMountPoint);

      const samples = 12;

      // interleaved calls to getVolumeMetadata to expose intra-thread data
      // leaks: if the metadata is not consistent, then the implementation is
      // not thread-safe.
      const inputs = shuffle([
        ...times(samples, () => expectedMountPoint),
        ...times(samples, () =>
          isWindows ? randomLetter() + ":\\" : "/" + randomLetters(12),
        ),
        ...times(samples, () => pickRandom(mountPoints)!),
      ]);

      const arr = await Promise.all(
        inputs.map(async (ea) => {
          try {
            return await getVolumeMetadata(ea);
          } catch (err) {
            if (ea === expectedMountPoint) {
              // we don't expect an error from the expected mount point! Those
              // should fail the test!
              throw err;
            } else return err as Error;
          }
        }),
      );

      for (const ea of arr) {
        if (ea instanceof Error) {
          expect(ea.message).toMatch(/not accessible/i);
        } else if (ea.mountPoint === expectedMountPoint) {
          // it's true that some metadata (like free space) can change between
          // calls. We don't expect it, but by omitting these fields, we don't
          // have to resort to retrying the test (which can hide actual bugs,
          // especially from multithreading).
          expect(omit(ea, "available", "used")).toEqual(
            omit(expected, "available", "used"),
          );
          // REMEMBER: NEVER USE toBeCloseTo -- the api is bonkers and only applicable for fractional numbers
          const delta = 8 * MiB;
          expect(ea.available).toBeWithin(
            expected.available - delta,
            expected.available + delta,
          );
          expect(ea.used).toBeWithin(
            expected.used - delta,
            expected.used + delta,
          );
        }
      }
    });

    if (isMacOS) {
      it("should handle Time Machine volumes if present", async () => {
        const mountPoints = await getVolumeMountPoints();
        const backupVolumes = mountPoints.filter(
          (mp) =>
            mp.includes("Backups.backupdb") ||
            mp.includes("Time Machine Backups"),
        );

        for (const volume of backupVolumes) {
          const metadata = await getVolumeMetadata(volume);
          assertMetadata(metadata);
          expect(metadata.fileSystem?.toLowerCase()).toMatch(/^(apfs|hfs)$/);
        }
      });
    }
  });

  describe("getAllVolumeMetadata()", () => {
    it("should get metadata for all volumes", async () => {
      const expectedMountPoints = await getVolumeMountPoints();
      const all = await getAllVolumeMetadata();
      expect(expectedMountPoints).toEqual(all.map((m) => m.mountPoint));
      for (const ea of all) {
        assertMetadata(ea);
      }
    });
  });

  describe("Timeout Handling", () => {
    beforeEach(() => {
      process.env["TEST_DELAY"] = "10";
    });
    afterEach(() => {
      delete process.env["TEST_DELAY"];
    });
    const rootPath = isWindows ? "C:\\" : "/";
    it("should handle getVolumeMountPoints() timeout", async () => {
      expect(getVolumeMountPoints({ timeoutMs: 1 })).rejects.toThrow(
        TimeoutError,
      );
    });
    it("should handle getVolumeMetadata() timeout", async () => {
      expect(getVolumeMetadata(rootPath, { timeoutMs: 1 })).rejects.toThrow(
        TimeoutError,
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid paths appropriately", async () => {
      const invalidPaths = [
        isWindows ? "A:\\" : "/nonexistent",
        isWindows
          ? "C:\\Really_Invalid_Path_123456789"
          : "/really/invalid/path/123456789",
        "",
        null,
        undefined,
      ];

      for (const path of invalidPaths) {
        await expect(getVolumeMetadata(path as string)).rejects.toThrow();
      }
    });
  });

  describe("Network Filesystems", () => {
    jest.setTimeout(10_000);

    const hasNetworkFS = async () => {
      const metadata = await Promise.all(
        (await getVolumeMountPoints()).map((mp) => getVolumeMetadata(mp)),
      );
      return metadata.some((m) => m.remote);
    };

    it("should correctly identify network filesystems", async () => {
      if (!(await hasNetworkFS())) {
        console.log(
          "Skipping network filesystem test - no network mounts found",
        );
        return;
      }

      const mountPoints = await getVolumeMountPoints();
      const metadata = await Promise.all(
        mountPoints.map((mp) => getVolumeMetadata(mp)),
      );

      const networkFS = metadata.filter((m) => m.remote);
      networkFS.forEach((meta) => {
        expect(meta.remote).toBe(true);

        if (meta.remoteHost) {
          expect(typeof meta.remoteHost).toBe("string");
          expect(meta.remoteHost.length).toBeGreaterThan(0);
        }
        if (meta.remoteShare) {
          expect(typeof meta.remoteShare).toBe("string");
          expect(meta.remoteShare.length).toBeGreaterThan(0);
        }
      });
    });
  });
});
