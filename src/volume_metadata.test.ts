// src/volume_metadata.test.ts

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

const rootPath = systemDrive();

describe("Volume Metadata", () => {
  beforeEach(() => {
    // Timeout configured globally in bootstrap
  });
  it("should get root filesystem metadata", async () => {
    const metadata = await getVolumeMetadata(rootPath);

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
            expect(String(error)).toMatch(/timeout/i); // < we can't check for instanceOf TimeoutError because it's imported from the tsup bundle
            return;
          } else if (!validMountPoints.includes(mountPoint)) {
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
        // Also, status can change between calls (healthy -> partial) during concurrent operations
        // Some fields like label, uri, uuid might not be returned consistently
        const dynamicFields = ["available", "used", "status"] as const;
        expect(omit(ea, ...dynamicFields)).toEqual(
          omit(expected, ...dynamicFields),
        );
        // Verify status is one of the valid values
        expect(["healthy", "partial", "unavailable"]).toContain(ea.status);
        // Verify optional fields are consistent types when they exist
        if (ea.label !== undefined) expect(typeof ea.label).toBe("string");
        if (ea.uri !== undefined) expect(typeof ea.uri).toBe("string");
        if (ea.uuid !== undefined) expect(typeof ea.uuid).toBe("string");
        // Per CLAUDE.md guidance: File system metadata like available/used space
        // changes continuously as other processes run. Only verify type/existence.
        expect(typeof ea.available).toBe("number");
        expect(typeof ea.used).toBe("number");

        // Sanity check: total size should roughly equal available + used
        // macOS has significant filesystem overhead/reserved space, other platforms less so
        if (
          typeof ea.size === "number" &&
          typeof ea.available === "number" &&
          typeof ea.used === "number"
        ) {
          const expectedTotal = ea.available + ea.used;
          const percentThreshold = isMacOS ? 33 : 15; // macOS needs higher threshold, Linux can have significant filesystem overhead too
          const allowedVariance = ea.size * (percentThreshold / 100);
          const difference = Math.abs(ea.size - expectedTotal);
          const actualPercent = (difference / ea.size) * 100;
          console.log(
            `Filesystem math check for ${ea.mountPoint}: difference=${difference} bytes (${actualPercent.toFixed(2)}% of total), threshold=${percentThreshold}%`,
          );
          expect(difference).toBeLessThanOrEqual(allowedVariance);
        }
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
  // Timeout configured globally in bootstrap

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
