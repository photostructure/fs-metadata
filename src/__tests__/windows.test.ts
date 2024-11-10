// src/__tests__/windows.test.ts

import { getVolumeMetadata, getVolumeMountPoints } from "../index";
import { assertMetadata } from "../test-utils/assert";
import { describePlatform } from "../test-utils/platform";

describe("Filesystem Metadata", () => {
  // Skip all tests if not on Windows
  const describeWindows = describePlatform("win32");

  describeWindows("Asynchronous Operations", () => {
    it("should get mount points without errors", async () => {
      const mountPoints = await getVolumeMountPoints();
      expect(Array.isArray(mountPoints)).toBe(true);
      expect(mountPoints.length).toBeGreaterThan(0);
      expect(mountPoints).toContain("C:\\");
    });

    it("should handle multiple getVolumeMountPoints calls", async () => {
      // Make multiple concurrent calls
      const promises = Array(3)
        .fill(0)
        .map(() => getVolumeMountPoints());
      const results = await Promise.all(promises);

      // Verify all results are valid
      results.forEach((mountPoints) => {
        expect(Array.isArray(mountPoints)).toBe(true);
        expect(mountPoints.length).toBeGreaterThan(0);
        expect(mountPoints).toContain("C:\\");
      });
    });

    it("should get C: drive metadata", async () => {
      const metadata = await getVolumeMetadata("C:\\");
      expect(metadata).toBeDefined();
      expect(metadata.mountPoint).toBe("C:\\");
      assertMetadata(metadata);
    });

    it("should handle multiple metadata calls for C:", async () => {
      const promises = Array(3)
        .fill(0)
        .map(() => getVolumeMetadata("C:\\"));
      const results = await Promise.all(promises);

      results.forEach((metadata) => {
        expect(metadata).toBeDefined();
        expect(metadata.mountPoint).toBe("C:\\");
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

    it("should handle empty or null mountPoint", async () => {
      // @ts-ignore - Testing invalid input
      await expect(getVolumeMetadata("")).rejects.toThrow(
        /mountPoint is required/i,
      );
      // @ts-ignore - Testing invalid input
      await expect(getVolumeMetadata(null)).rejects.toThrow(
        /mountpoint is required/i,
      );
    });
  });

  describeWindows("Basic Filesystem Operations", () => {
    it("should work with valid Windows system paths", async () => {
      if (process.env.SystemDrive) {
        const systemDrive = process.env.SystemDrive + "\\";
        const metadata = await getVolumeMetadata(systemDrive);
        expect(metadata).toBeDefined();
        expect(metadata.mountPoint).toBe(systemDrive);
        assertMetadata(metadata);
      }
    });
    it("should return consistent drive information", async () => {
      const arr = await getVolumeMountPoints();
      console.log("current mountPoints: " + JSON.stringify(arr));
      for (const drive of arr) {
        let metadata;
        try {
          metadata = await getVolumeMetadata(drive);
          console.log("fetched metadata: " + JSON.stringify(metadata));
        } catch (error) {
          // Some drives might not be accessible (e.g., empty DVD drive)
          console.warn(`Skipping inaccessible drive ${drive}: ${error}`);
          continue;
        }
        expect(metadata).toBeDefined();
        expect(metadata?.mountPoint).toBe(drive);
        assertMetadata(metadata);
      }
    });
  });
});
