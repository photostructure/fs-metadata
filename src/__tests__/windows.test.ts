// src/__tests__/windows.test.ts
import { getMountpoints, getVolumeMetadata } from "../index";
import { assertMetadata } from "../test-utils/assert";
import { describePlatform } from "../test-utils/platform";

describe("Filesystem Metadata", () => {
  // Skip all tests if not on Windows
  const describeWindows = describePlatform("win32");

  describeWindows("Asynchronous Operations", () => {
    it("should get mountpoints without errors", async () => {
      const mountpoints = await getMountpoints();
      expect(Array.isArray(mountpoints)).toBe(true);
      expect(mountpoints.length).toBeGreaterThan(0);
      expect(mountpoints).toContain("C:\\");
    });

    it("should handle multiple getMountpoints calls", async () => {
      // Make multiple concurrent calls
      const promises = Array(3)
        .fill(0)
        .map(() => getMountpoints());
      const results = await Promise.all(promises);

      // Verify all results are valid
      results.forEach((mountpoints) => {
        expect(Array.isArray(mountpoints)).toBe(true);
        expect(mountpoints.length).toBeGreaterThan(0);
        expect(mountpoints).toContain("C:\\");
      });
    });

    it("should get C: drive metadata", async () => {
      const metadata = await getVolumeMetadata("C:\\");
      expect(metadata).toBeDefined();
      expect(metadata.mountpoint).toBe("C:\\");
      assertMetadata(metadata);
    });

    it("should handle multiple metadata calls for C:", async () => {
      const promises = Array(3)
        .fill(0)
        .map(() => getVolumeMetadata("C:\\"));
      const results = await Promise.all(promises);

      results.forEach((metadata) => {
        expect(metadata).toBeDefined();
        expect(metadata.mountpoint).toBe("C:\\");
        assertMetadata(metadata);
      });
    });
  });

  describeWindows("Error Handling", () => {
    it("should handle invalid paths appropriately", async () => {
      const invalidPaths = [
        "Z:\\NonExistentPath", // Typically non-existent drive
        "C:\\Really_Invalid_Path_That_Should_Not_Exist_123456789",
      ];

      for (const path of invalidPaths) {
        await expect(getVolumeMetadata(path)).rejects.toThrow();
      }
    });

    it("should handle empty or null mountpoint", async () => {
      // @ts-ignore - Testing invalid input
      await expect(getVolumeMetadata("")).rejects.toThrow(
        "Mountpoint is required",
      );
      // @ts-ignore - Testing invalid input
      await expect(getVolumeMetadata(null)).rejects.toThrow(
        "Mountpoint is required",
      );
    });
  });

  describeWindows("Basic Filesystem Operations", () => {
    it("should work with valid Windows system paths", async () => {
      if (process.env.SystemDrive) {
        const systemDrive = process.env.SystemDrive + "\\";
        const metadata = await getVolumeMetadata(systemDrive);
        expect(metadata).toBeDefined();
        expect(metadata.mountpoint).toBe(systemDrive);
        assertMetadata(metadata);
      }
    });
    it("should return consistent drive information", async () => {
      const arr = await getMountpoints();
      console.log("current mountpoints: " + JSON.stringify(arr))
      for (const drive of arr) {
        let metadata;
        try {
          metadata = await getVolumeMetadata(drive);
          console.log("fetched metadata: " + JSON.stringify(metadata))
        } catch (error) {
          // Some drives might not be accessible (e.g., empty DVD drive)
          console.warn(`Skipping inaccessible drive ${drive}: ${error}`);
          continue
        }
        expect(metadata).toBeDefined();
        expect(metadata?.mountpoint).toBe(drive);
        assertMetadata(metadata);
      }
    });
  });
});
