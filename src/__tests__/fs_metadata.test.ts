// src/__tests__/fs_metadata.test.ts

import { platform } from "node:os";
import { sortByStr } from "../array.js";
import { TimeoutError } from "../async.js";
import { ExcludedMountPointGlobsDefault, getVolumeMetadata, getVolumeMountPoints, TimeoutMsDefault } from "../index.js";
import { assertMetadata } from "../test-utils/assert.js";

const isWindows = platform() === "win32";
const isMacOS = platform() === "darwin";
const isLinux = platform() === "linux";

describe("Filesystem Metadata", () => {
  jest.setTimeout(15_000);

  const opts = {
    timeoutMs: TimeoutMsDefault * 2,
    excludedMountPointGlobs: [...ExcludedMountPointGlobsDefault, "**/wsl*/**"],
  };

  describe("Mount Points", () => {
    it("should list mount points without errors", async () => {
      const mountPoints = await getVolumeMountPoints(opts);
      expect(Array.isArray(mountPoints)).toBe(true);
      expect(mountPoints.length).toBeGreaterThan(0);

      // Platform-specific root checks
      if (isWindows) {
        expect(mountPoints).toContain("C:\\");
      } else {
        expect(mountPoints).toContain("/");
      }
    });

    it("should handle concurrent mountPoint requests", async () => {
      const promises = Array(8).fill(0).map(() => getVolumeMountPoints(opts));
      const results = await Promise.all(promises);

      results.forEach((mountPoints) => {
        expect(Array.isArray(mountPoints)).toBe(true);
        expect(mountPoints.length).toBeGreaterThan(0);
        
        if (isWindows) {
          expect(mountPoints).toContain("C:\\");
        } else {
          expect(mountPoints).toContain("/");
        }
      });

      // All results should be identical
      const [first, ...rest] = results;
      for (const arr of rest) {
        expect(arr).toEqual(first);
      }
    });

    if (!isWindows) {
      it("should exclude pseudo filesystems", async () => {
        const mountPoints = await getVolumeMountPoints(opts);
        const pseudoFS = isLinux 
          ? ["/proc", "/sys", "/dev/pts"]
          : ["/dev", "/dev/fd"];

        pseudoFS.forEach((fs) => {
          expect(mountPoints).not.toContain(fs);
        });
      });
    }

    it("should return sorted mount points", async () => {
      const mountPoints = await getVolumeMountPoints(opts);
      const sorted = sortByStr([...mountPoints], (ea) => ea);
      expect(mountPoints).toEqual(sorted);
    });
  });

  describe("Volume Metadata", () => {
    it("should get root filesystem metadata", async () => {
      const rootPath = isWindows ? "C:\\" : "/";
      const metadata = await getVolumeMetadata(rootPath, opts);
      
      expect(metadata.mountPoint).toBe(rootPath);
      assertMetadata(metadata);

      // Platform-specific filesystem checks
      if (isWindows) {
        expect(metadata.fileSystem?.toLowerCase()).toMatch(/^(ntfs|refs)$/);
      } else if (isMacOS) {
        expect(metadata.fileSystem?.toLowerCase()).toMatch(/^(apfs|hfs)$/);
      } else if (isLinux) {
        expect(metadata.fileSystem?.toLowerCase()).toMatch(/^(ext[234]|xfs|btrfs|zfs)$/);
      }
    });

    it("should handle concurrent metadata requests", async () => {
      const rootPath = isWindows ? "C:\\" : "/";
      const promises = Array(3).fill(0).map(() => getVolumeMetadata(rootPath, opts));
      const results = await Promise.all(promises);

      results.forEach((metadata) => {
        expect(metadata.mountPoint).toBe(rootPath);
        assertMetadata(metadata);
      });
    });

    if (isMacOS) {
      it("should handle Time Machine volumes if present", async () => {
        const mountPoints = await getVolumeMountPoints(opts);
        const backupVolumes = mountPoints.filter(mp => 
          mp.includes("Backups.backupdb") || mp.includes("Time Machine Backups")
        );

        for (const volume of backupVolumes) {
          const metadata = await getVolumeMetadata(volume, opts);
          assertMetadata(metadata);
          expect(metadata.fileSystem?.toLowerCase()).toMatch(/^(apfs|hfs)$/);
        }
      });
    }
  });

  describe("Error Handling", () => {
    it("should reject with timeoutMs=1", async () => {
      const rootPath = isWindows ? "C:\\" : "/";
      await expect(getVolumeMountPoints({ timeoutMs: 1 }))
        .rejects.toThrow(TimeoutError);
      await expect(getVolumeMetadata(rootPath, { timeoutMs: 1 }))
        .rejects.toThrow(TimeoutError);
    });

    it("should handle invalid paths appropriately", async () => {
      const invalidPaths = [
        isWindows ? "Z:\\NonExistentPath" : "/nonexistent",
        isWindows ? "C:\\Really_Invalid_Path_123456789" : "/really/invalid/path/123456789",
        "",
        null,
        undefined,
      ];

      for (const path of invalidPaths) {
        await expect(getVolumeMetadata(path as any)).rejects.toThrow();
      }
    });
  });

  describe("Network Filesystems", () => {
    jest.setTimeout(10_000);

    const hasNetworkFS = async () => {
      const metadata = await Promise.all(
        (await getVolumeMountPoints(opts)).map(mp => getVolumeMetadata(mp, opts))
      );
      return metadata.some(m => m.remote);
    };

    it("should correctly identify network filesystems", async () => {
      if (!(await hasNetworkFS())) {
        console.log("Skipping network filesystem test - no network mounts found");
        return;
      }

      const mountPoints = await getVolumeMountPoints(opts);
      const metadata = await Promise.all(
        mountPoints.map(mp => getVolumeMetadata(mp, opts))
      );

      const networkFS = metadata.filter(m => m.remote);
      networkFS.forEach(meta => {
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