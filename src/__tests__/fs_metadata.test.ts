/* eslint-disable @typescript-eslint/no-non-null-assertion */
// src/__tests__/fs_metadata.test.ts

import { jest } from "@jest/globals";
import { times, uniq } from "../array.js";
import { TimeoutError } from "../async.js";
import {
  getAllVolumeMetadata,
  getVolumeMetadata,
  getVolumeMountPoints,
  MountPoint,
  VolumeMetadata,
} from "../index.js";
import { omit, pick } from "../object.js";
import { IncludeSystemVolumesDefault } from "../options.js";
import { isLinux, isMacOS, isWindows } from "../platform.js";
import { pickRandom, randomLetter, randomLetters, shuffle } from "../random.js";
import { sortByLocale } from "../string.js";
import { assertMetadata } from "../test-utils/assert.js";
import { MiB } from "../units.js";

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

  describe("Volume Metadata", () => {
    it("should get root filesystem metadata", async () => {
      const rootPath = isWindows ? "C:\\" : "/";
      const metadata = await getVolumeMetadata(rootPath);

      console.dir(metadata);

      expect(metadata.mountPoint).toBe(rootPath);
      assertMetadata(metadata);

      // Platform-specific filesystem checks
      if (isWindows) {
        expect(metadata.fstype).toMatch(/^(ntfs|refs)$/i);
      } else if (isMacOS) {
        expect(metadata.fstype).toMatch(/^(apfs|hfs)$/i);
      } else if (isLinux) {
        // We expect "overlay" for Docker containers
        expect(metadata.fstype).toMatch(/^(ext[234]|xfs|btrfs|zfs|overlay)$/i);
      }
    });
  });
  describe("Volume Metadata errors", () => {
    it("handles non-existant mount points (from native)", async () => {
      await expect(getVolumeMetadata("/nonexistent")).rejects.toThrow(
        isWindows
          ? /ENOENT|not accessible/i
          : /ENOENT|statvfs|Failed to get volume (statistics|information)/i,
      );
    });

    it("handles non-existant mount points (from js)", async () => {
      await expect(getVolumeMetadata("/nonexistent")).rejects.toThrow(
        /ENOENT|not accessible/i,
      );
    });
  });

  describe("concurrent", () => {
    it("should handle concurrent getVolumeMetadata() calls", async () => {
      const mountPoints = await getVolumeMountPoints();
      const expectedMountPoint = mountPoints[0]!.mountPoint;
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
        ...times(samples, () => pickRandom(mountPoints)!.mountPoint),
      ]);

      const arr = await Promise.all(
        inputs.map(async (ea) => {
          // throw in some expected timeouts just to test more code paths
          const timeoutMs = pickRandom([1, undefined]) as number;
          try {
            return await getVolumeMetadata(ea, { timeoutMs });
          } catch (err) {
            if (ea === expectedMountPoint && timeoutMs !== 1) {
              // we don't expect an error from the expected mount point! Those
              // should fail the test!
              throw err;
            } else return err as Error;
          }
        }),
      );

      for (const ea of arr) {
        if (ea instanceof Error) {
          expect(String(ea)).toMatch(
            /EACCES|ENOTDIR|ENOENT|timeout|not accessible/i,
          );
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
  });

  describe("getAllVolumeMetadata()", () => {
    it("should get metadata for all volumes", async () => {
      const allMountPoints = await getVolumeMountPoints();
      const healthyMountPoints = allMountPoints.filter(
        (ea) => (ea.status ?? "healthy") === "healthy",
      );
      const expectedMountPoints = IncludeSystemVolumesDefault
        ? healthyMountPoints
        : healthyMountPoints.filter((ea) => !ea.isSystemVolume);

      const all = (await getAllVolumeMetadata()).filter(
        (ea): ea is VolumeMetadata =>
          !("error" in ea) && (ea.status ?? "healthy") === "healthy",
      );
      expect(expectedMountPoints).toEqual(
        all.map((ea) =>
          pick(
            ea as VolumeMetadata,
            "mountPoint",
            "isSystemVolume",
            "fstype",
            "status",
          ),
        ),
      );
      for (const ea of all) {
        if (!("error" in ea)) {
          assertMetadata(ea);
        }
      }
    });
  });

  // We rely on native timeouts on Windows and that doesn't support TEST_DELAY
  // (which is required to deflake these tests)

  if (!isWindows) {
    describe("Timeout Handling", () => {
      beforeEach(() => {
        process.env["TEST_DELAY"] = "10";
      });
      afterEach(() => {
        delete process.env["TEST_DELAY"];
      });
      const rootPath = isWindows ? "C:\\" : "/";

      it("should handle getVolumeMountPoints() timeout", async () => {
        await expect(
          getVolumeMountPoints({ timeoutMs: 1 }),
        ).rejects.toBeInstanceOf(TimeoutError);
      });

      it("should handle getVolumeMetadata() timeout", async () => {
        await expect(
          getVolumeMetadata(rootPath, { timeoutMs: 1 }),
        ).rejects.toBeInstanceOf(TimeoutError);
      });
    });
  }

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
        await expect(getVolumeMetadata(path as string)).rejects.toThrow(
          /ENOENT|invalid|not accessible/i,
        );
      }
    });
  });

  describe("Network Filesystems", () => {
    jest.setTimeout(10_000);

    it("should correctly identify network filesystems", async () => {
      for (const mp of await getVolumeMountPoints()) {
        if (!mp.isSystemVolume && mp.status === "healthy") {
          const meta = await getVolumeMetadata(mp.mountPoint);
          if (meta.remote) {
            expect(meta.isSystemVolume).toBe(false);

            if (meta.remoteHost) {
              expect(typeof meta.remoteHost).toBe("string");
              expect(meta.remoteHost.length).toBeGreaterThan(0);
            }
            if (meta.remoteShare) {
              expect(typeof meta.remoteShare).toBe("string");
              expect(meta.remoteShare.length).toBeGreaterThan(0);
            }
          }
        }
      }
    });
  });
});
