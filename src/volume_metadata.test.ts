/* eslint-disable @typescript-eslint/no-non-null-assertion */
// src/volume_metadata.test.ts

import { jest } from "@jest/globals";
import { times } from "./array.js";
import { TimeoutError } from "./async.js";
import {
  getAllVolumeMetadata,
  getVolumeMetadata,
  getVolumeMountPoints,
  VolumeHealthStatuses,
} from "./index.js";
import { omit } from "./object.js";
import { IncludeSystemVolumesDefault } from "./options.js";
import { isLinux, isMacOS, isWindows } from "./platform.js";
import { pickRandom, randomLetter, randomLetters, shuffle } from "./random.js";
import { assertMetadata } from "./test-utils/assert.js";
import { MiB } from "./units.js";

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
  jest.setTimeout(30_000);

  it("should handle concurrent getVolumeMetadata() calls", async () => {
    const mountPoints = await getVolumeMountPoints();
    const expectedMountPoint = mountPoints[0]!.mountPoint;
    const expected = await getVolumeMetadata(expectedMountPoint);

    const validMountPoints = mountPoints
      .filter((ea) => ea.status === VolumeHealthStatuses.healthy)
      .map((ea) => ea.mountPoint);

    const samples = 12;

    // interleaved calls to getVolumeMetadata to expose intra-thread data
    // leaks: if the metadata is not consistent, then the implementation is
    // not thread-safe.
    const inputs = shuffle([
      ...times(samples, () => expectedMountPoint),
      ...times(samples, () =>
        isWindows
          ? randomLetter().toUpperCase() + ":\\"
          : "/" + randomLetters(12),
      ),
      ...times(samples, () => pickRandom(mountPoints)!.mountPoint),
    ]);

    const arr = await Promise.all(
      inputs.map(async (ea) => {
        // throw in some expected timeouts just to test more code paths
        const timeoutMs = pickRandom([0, 1, undefined]) as number;
        const p = getVolumeMetadata(ea, { timeoutMs });
        if (timeoutMs === 1) {
          await expect(p).rejects.toThrow(TimeoutError);
        } else if (!validMountPoints.includes(ea)) {
          await expect(p).rejects.toThrow(/ENOENT|not accessible|opendir/i);
        }
        return p;
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
          expected.available! - delta,
          expected.available! + delta,
        );
        expect(ea.used).toBeWithin(
          expected.used! - delta,
          expected.used! + delta,
        );
      }
    }
  });
});

describe("getAllVolumeMetadata()", () => {
  it("should get metadata for all volumes", async () => {
    const allMountPoints = await getVolumeMountPoints();
    const byMountPoint = new Map(
      allMountPoints.map((ea) => [ea.mountPoint, ea]),
    );

    const all = await getAllVolumeMetadata();
    const skipExpectedMountPoints = new Set(
      allMountPoints
        .filter((ea) => ea.status !== VolumeHealthStatuses.healthy)
        .map((ea) => ea.mountPoint),
    );
    if (!IncludeSystemVolumesDefault) {
      for (const ea of allMountPoints) {
        if (ea.isSystemVolume) {
          skipExpectedMountPoints.add(ea.mountPoint);
        }
      }
    }
    for (const ea of all) {
      const skipExpected = skipExpectedMountPoints.has(ea.mountPoint);
      if (skipExpected) {
        expect(ea).toHaveProperty("error");
      } else {
        expect(ea).toEqual(
          expect.objectContaining(byMountPoint.get(ea.mountPoint)),
        );
        assertMetadata(ea);
      }
    }
  });
});

if (!isWindows) {
  describe("Timeout Handling", () => {
    const rootPath = isWindows ? "C:\\" : "/";

    it("should handle getVolumeMountPoints() timeout", async () => {
      await expect(getVolumeMountPoints({ timeoutMs: 1 })).rejects.toThrow(
        /timeout/i,
      );
    });

    it("should handle getVolumeMetadata() timeout", async () => {
      await expect(
        getVolumeMetadata(rootPath, { timeoutMs: 1 }),
      ).rejects.toThrow(/timeout/i);
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
