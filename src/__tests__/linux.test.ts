// src/__tests__/linux.test.ts
import { getMountpoints, getVolumeMetadata } from "../index";
import { assertMetadata } from "../test-utils/assert";
import { describePlatform } from "../test-utils/platform";

describe("Linux Filesystem Metadata", () => {
  // Skip all tests if not on Linux
  const describeLinux = describePlatform("linux");

  describeLinux("Mountpoint Operations", () => {
    it("should list mountpoints without errors", async () => {
      const mountpoints = await getMountpoints();
      expect(Array.isArray(mountpoints)).toBe(true);
      expect(mountpoints.length).toBeGreaterThan(0);
      expect(mountpoints).toContain("/");
    });

    it("should handle concurrent mountpoint requests", async () => {
      const promises = Array(3)
        .fill(0)
        .map(() => getMountpoints());
      const results = await Promise.all(promises);

      results.forEach((mountpoints) => {
        expect(Array.isArray(mountpoints)).toBe(true);
        expect(mountpoints.length).toBeGreaterThan(0);
        expect(mountpoints).toContain("/");
      });

      // All results should be identical since we're reading the same file
      const [first, ...rest] = results;
      rest.forEach((mountpoints) => {
        expect(mountpoints).toEqual(first);
      });
    });

    it("should exclude pseudo filesystems", async () => {
      const mountpoints = await getMountpoints();
      const pseudoFS = ["/proc", "/sys", "/dev/pts"];
      pseudoFS.forEach((fs) => {
        expect(mountpoints).not.toContain(fs);
      });
    });

    it("should only return absolute paths", async () => {
      const mountpoints = await getMountpoints();
      mountpoints.forEach((mountpoint) => {
        expect(mountpoint.startsWith("/")).toBe(true);
      });
    });

    it("should return sorted mountpoints", async () => {
      const mountpoints = await getMountpoints();
      const sorted = [...mountpoints].sort();
      expect(mountpoints).toEqual(sorted);
    });
  });

  describeLinux("Volume Metadata", () => {
    it("should get root filesystem metadata", async () => {
      const metadata = await getVolumeMetadata("/");
      expect(metadata.mountpoint).toBe("/");
      assertMetadata(metadata);
    });

    it("should handle concurrent metadata requests", async () => {
      const promises = Array(3)
        .fill(0)
        .map(() => getVolumeMetadata("/"));
      const results = await Promise.all(promises);

      results.forEach((metadata) => {
        expect(metadata.mountpoint).toBe("/");
        assertMetadata(metadata);
      });
    });

    it("should get metadata for /home if it exists", async () => {
      const mountpoints = await getMountpoints();
      if (mountpoints.includes("/home")) {
        const metadata = await getVolumeMetadata("/home");
        expect(metadata.mountpoint).toBe("/home");
        assertMetadata(metadata);
      }
    });
  });

  describeLinux("Error Handling", () => {
    it("should reject invalid mountpoints", async () => {
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

  describeLinux("Network Filesystems", () => {
    const hasNetworkFS = async () => {
      const metadata = await Promise.all(
        (await getMountpoints()).map((mp) => getVolumeMetadata(mp)),
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

      const mountpoints = await getMountpoints();
      const arr = await Promise.all(
        mountpoints.map((mp) => getVolumeMetadata(mp)),
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

  describeLinux("Filesystem Types", () => {
    it("should report correct filesystem types", async () => {
      const metadata = await getVolumeMetadata("/");
      expect(metadata.filesystem).toMatch(/^(ext[234]|xfs|btrfs|zfs)$/);
    });

    it("should handle all mounted filesystem types", async () => {
      const mountpoints = await getMountpoints();
      const arr = await Promise.all(
        mountpoints.map((mp) => getVolumeMetadata(mp)),
      );

      arr.forEach((metadata) => {
        expect(typeof metadata.filesystem).toBe("string");
        expect(metadata.filesystem?.length).toBeGreaterThan(0);
      });
    });
  });
});
