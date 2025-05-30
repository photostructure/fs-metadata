// src/volume_metadata.test.ts

import { jest } from "@jest/globals";
import { join } from "node:path";
import { compact, times } from "./array";
import {
  getAllVolumeMetadata,
  getVolumeMetadata,
  getVolumeMountPoints,
  VolumeHealthStatuses,
} from "./index";
import { omit } from "./object";
import { IncludeSystemVolumesDefault } from "./options";
import { isLinux, isMacOS, isWindows } from "./platform";
import { pickRandom, randomLetter, randomLetters, shuffle } from "./random";
import { assertMetadata } from "./test-utils/assert";
import { systemDrive } from "./test-utils/platform";
import { MiB } from "./units";

const rootPath = systemDrive();

describe("Volume Metadata", () => {
  beforeEach(() => {
    jest.setTimeout(30_000);
  });
  it("should get root filesystem metadata", async () => {
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

  it("handles null mountPoint", async () => {
    await expect(getVolumeMetadata(null as unknown as string)).rejects.toThrow(
      /Invalid mountPoint/,
    );
  });

  it("handles empty string mountPoint", async () => {
    await expect(getVolumeMetadata("")).rejects.toThrow(/Invalid mountPoint/);
  });

  it("handles whitespace-only mountPoint", async () => {
    await expect(getVolumeMetadata("   ")).rejects.toThrow(
      /Invalid mountPoint/,
    );
  });
});

describe("concurrent", () => {
  it("should handle concurrent getVolumeMetadata() calls", async () => {
    const mountPoints = await getVolumeMountPoints();
    const expectedMountPoint = systemDrive();
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
      ...times(samples, () => pickRandom(mountPoints).mountPoint),
    ]);

    const arr = await Promise.all(
      inputs.map(async (mountPoint) => {
        const timeoutMs = pickRandom([0, 1, undefined]) as number;
        try {
          // throw in some expected timeouts just to test more code paths
          return await getVolumeMetadata(mountPoint, { timeoutMs });
        } catch (error) {
          if (timeoutMs === 1) {
            console.log("Expected timeout", { mountPoint, timeoutMs, error });
            expect(String(error)).toMatch(/timeout/i); // < we can't check for instanceOf TimeoutError because it's imported from the tsup bundle
            return;
          } else if (!validMountPoints.includes(mountPoint)) {
            console.log("Expected bad mount point", {
              mountPoint,
              timeoutMs,
              error,
            });
            expect(String(error)).toMatch(
              /EINVAL|ENOENT|not accessible|opendir/i,
            );
            return;
          } else {
            console.log("Unexpected error", { mountPoint, timeoutMs, error });
            throw error;
          }
        }
      }),
    );

    for (const ea of compact(arr)) {
      if (ea.mountPoint === expectedMountPoint) {
        // it's true that some metadata (like free space) can change between
        // calls. We don't expect it, but by omitting these fields, we don't
        // have to resort to retrying the test (which can hide actual bugs,
        // especially from multithreading).
        expect(omit(ea, "available", "used")).toEqual(
          omit(expected, "available", "used"),
        );
        // REMEMBER: NEVER USE toBeCloseTo -- the api is bonkers and only
        // applicable for fractional numbers
        // GHA runners may differ by more than 20Mb, and macOS can differ by 95 Mb (!!)
        const delta = (isMacOS ? 100 : 20) * MiB;
        expect(ea.available).toBeWithinDelta(
          expected.available as number,
          delta,
        );
        expect(ea.used).toBeWithinDelta(expected.used as number, delta);
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
      isWindows ? "A:\\" : "/nonexistent-root-directory",
      join(rootPath, "nonexistent", "path", "123456789"),
      "",
      null,
      undefined,
    ];

    for (const path of invalidPaths) {
      await expect(getVolumeMetadata(path as string)).rejects.toThrow(
        /ENOENT|invalid|not accessible|opendir/i,
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
