// src/__tests__/unix.test.ts

import { getVolumeMetadata, getVolumeMountPoints } from "../index";
import { assertMetadata } from "../test-utils/assert";

const isUnix = process.platform === "linux" || process.platform === "darwin";
const describeUnix = (name: string, fn: () => void) => {
  return isUnix ? describe(name, fn) : describe.skip(name, fn);
};

describeUnix("Unix (Linux/macOS) File system metadata", () => {
  // Run tests only on Unix-like systems

  // Platform-specific filesystem types
  const getExpectedFSTypes = () => {
    if (process.platform === "linux") {
      return /^(ext[234]|xfs|btrfs|zfs)$/;
    } else {
      return /^(apfs|hfs|msdos|ntfs)$/;
    }
  };

  describe("getVolumeMountPoints()", () => {
    it("should list mount points without errors", async () => {
      const mountPoints = await getVolumeMountPoints();
      expect(Array.isArray(mountPoints)).toBe(true);
      expect(mountPoints.length).toBeGreaterThan(0);
      expect(mountPoints).toContain("/");
    });

    it("should handle concurrent mountPoint requests", async () => {
      const promises = Array(3)
        .fill(0)
        .map(() => getVolumeMountPoints());
      const results = await Promise.all(promises);

      results.forEach((arr) => {
        expect(Array.isArray(arr)).toBe(true);
        expect(arr.length).toBeGreaterThan(0);
        expect(arr).toContain("/");
      });

      // All results should be identical since we're reading the same system state
      const [first, ...rest] = results;
      for (const arr of rest) {
        expect(arr).toEqual(first);
      }
    });

    it("should exclude pseudo filesystems", async () => {
      const mountPoints = await getVolumeMountPoints();
      const pseudoFS =
        process.platform === "linux"
          ? ["/proc", "/sys", "/dev/pts"]
          : ["/dev", "/dev/fd"];

      pseudoFS.forEach((fs) => {
        expect(mountPoints).not.toContain(fs);
      });
    });

    it("should only return absolute paths", async () => {
      const mountPoints = await getVolumeMountPoints();
      mountPoints.forEach((mountPoint) => {
        expect(mountPoint.startsWith("/")).toBe(true);
      });
    });

    it("should return sorted mount points", async () => {
      const mountPoints = await getVolumeMountPoints();
      const sorted = [...mountPoints].sort();
      expect(mountPoints).toEqual(sorted);
    });
  });

  describe("Volume Metadata", () => {
    it("should get root filesystem metadata", async () => {
      const metadata = await getVolumeMetadata("/");
      expect(metadata.mountPoint).toBe("/");
      assertMetadata(metadata);
    });

    it("should handle concurrent metadata requests", async () => {
      const promises = Array(3)
        .fill(0)
        .map(() => getVolumeMetadata("/"));
      const results = await Promise.all(promises);

      results.forEach((metadata) => {
        expect(metadata.mountPoint).toBe("/");
        assertMetadata(metadata);
      });
    });

    it("should get metadata for standard system paths", async () => {
      const standardPaths =
        process.platform === "darwin"
          ? ["/", "/System", "/Users"]
          : ["/", "/home"];

      const mountPoints = await getVolumeMountPoints();
      for (const path of standardPaths) {
        if (mountPoints.includes(path)) {
          const metadata = await getVolumeMetadata(path);
          expect(metadata.mountPoint).toBe(path);
          assertMetadata(metadata);
        }
      }
    });
  });

  describe("Error Handling", () => {
    it("should reject invalid mountPoints", async () => {
      const invalidPaths = [
        "/nonexistent",
        "/really/invalid/path/that/should/not/exist",
        "",
        null,
        undefined,
      ];

      for (const path of invalidPaths) {
        await expect(getVolumeMetadata(path as any)).rejects.toThrow();
      }
    });

    it("should handle non-absolute paths appropriately", async () => {
      const relativePaths = ["home", "./home", "../home"];

      for (const path of relativePaths) {
        await expect(getVolumeMetadata(path)).rejects.toThrow();
      }
    });
  });

  describeUnix("Network Filesystems", () => {
    const hasNetworkFS = async () => {
      const metadata = await Promise.all(
        (await getVolumeMountPoints()).map((mp) => getVolumeMetadata(mp)),
      );
      return metadata.some((m) => m.remote);
    };

    it("should correctly identify network filesystems", async () => {
      // Skip if no network filesystems are mounted
      if (!(await hasNetworkFS())) {
        console.log(
          "Skipping network filesystem test - no network mounts found",
        );
        return;
      }

      const mountPoints = await getVolumeMountPoints();
      const arr = await Promise.all(
        mountPoints.map((mp) => getVolumeMetadata(mp)),
      );

      const networkFS = arr.filter((m) => m.remote);
      networkFS.forEach((metadata) => {
        expect(metadata.remote).toBe(true);
        // Network filesystems should have additional metadata
        if (metadata.remoteHost) {
          expect(typeof metadata.remoteHost).toBe("string");
          expect(metadata.remoteHost.length).toBeGreaterThan(0);
        }
        if (metadata.remoteShare) {
          expect(typeof metadata.remoteShare).toBe("string");
          expect(metadata.remoteShare.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe("Filesystem Types", () => {
    it("should report correct filesystem types", async () => {
      const metadata = await getVolumeMetadata("/");
      expect(metadata.fileSystem).toMatch(getExpectedFSTypes());
    });

    it("should handle all mounted filesystem types", async () => {
      const mountPoints = await getVolumeMountPoints();
      const arr = await Promise.all(
        mountPoints.map((mp) => getVolumeMetadata(mp)),
      );

      arr.forEach((metadata) => {
        expect(typeof metadata.fileSystem).toBe("string");
        expect(metadata.fileSystem?.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Platform-Specific Features", () => {
    if (process.platform === "darwin") {
      it("should handle APFS volumes correctly", async () => {
        const metadata = await getVolumeMetadata("/");
        if (metadata.fileSystem?.toLowerCase() === "apfs") {
          expect(metadata.uuid).toBeDefined();
          expect(metadata.label).toBeDefined();
        }
      });

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

    if (process.platform === "linux") {
      it("should handle Linux-specific mount options", async () => {
        const metadata = await getVolumeMetadata("/");
        if (metadata.uuid) {
          expect(metadata.uuid).toMatch(/^[0-9a-f-]{36}$/i);
        }
      });
    }
  });
});
