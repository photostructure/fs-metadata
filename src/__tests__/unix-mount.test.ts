// src/__tests__/unix-mount.test.ts

import { getVolumeMountPoints } from "../index.js";
import { describePlatform } from "../test-utils/platform.js";
import { execAndParseMount } from "../unix/mount.js";

const describeUnix = (name: string, fn: () => void) => {
  const isUnix = process.platform === "linux" || process.platform === "darwin";
  return isUnix ? describe(name, fn) : describe.skip(name, fn);
};

const describeLinux = describePlatform("linux");
const describeDarwin = describePlatform("darwin");

describeUnix("Unix Mount Points Parser", () => {
  describe("parseMount()", () => {
    it("should return an array of mount points", async () => {
      const mountPoints = await execAndParseMount();
      expect(Array.isArray(mountPoints)).toBe(true);
      expect(mountPoints.length).toBeGreaterThan(0);
    });

    it("should have valid mount point objects", async () => {
      const mountPoints = await execAndParseMount();

      for (const mount of mountPoints) {
        expect(mount).toMatchObject({
          mountPoint: expect.any(String),
          device: expect.any(String),
          type: expect.any(String),
          options: expect.any(Array),
        });

        // Mount point should be an absolute path
        expect(mount.mountPoint).toMatch(/^\//);

        // Options should be non-empty array of strings
        mount.options.forEach((option) => {
          expect(option).toBeInstanceOf(String);
          expect(option.length).toBeGreaterThan(0);
        });
      }
    });

    it("should match getVolumeMountPoints results", async () => {
      const mountPoints = await execAndParseMount();
      const volumeMountPoints = await getVolumeMountPoints();

      // All volume mount points should exist in parseMount results
      for (const volumePoint of volumeMountPoints) {
        const found = mountPoints.some(
          (mount) => mount.mountPoint === volumePoint,
        );
        expect(found).toBe(true);
      }
    });

    describeLinux("Linux-specific tests", () => {
      it("should have expected Linux filesystem types", async () => {
        const mountPoints = await execAndParseMount();
        const expectedTypes = ["ext4", "ext3", "xfs", "btrfs", "zfs"];

        // Root filesystem should be one of the expected types
        const rootMount = mountPoints.find((mount) => mount.mountPoint === "/");
        expect(rootMount).toBeDefined();
        expect(expectedTypes).toContain(rootMount?.fstype);
      });

      it("should handle Linux-style mount options", async () => {
        const mountPoints = await execAndParseMount();
        const commonOptions = ["rw", "relatime", "defaults"];

        mountPoints.forEach((mount) => {
          // At least one common option should be present
          expect(mount.options.some((opt) => commonOptions.includes(opt))).toBe(
            true,
          );
        });
      });
    });

    describeDarwin("macOS-specific tests", () => {
      it("should have expected macOS filesystem types", async () => {
        const mountPoints = await execAndParseMount();
        const expectedTypes = ["apfs", "hfs", "autofs", "devfs"];

        // Root filesystem should be one of the expected types
        const rootMount = mountPoints.find((mount) => mount.mountPoint === "/");
        expect(rootMount).toBeDefined();
        expect(expectedTypes).toContain(rootMount?.fstype);
      });

      it("should handle macOS-style mount options", async () => {
        const mountPoints = await execAndParseMount();
        console.log({ mountPoints });
        const commonOptions = [
          "read-only",
          "local",
          "nodev",
          "nosuid",
          "sealed",
          "journaled",
          "nobrowse",
          "automounted",
          "hidden",
          "shadow",
          "protect",
        ];
        mountPoints.forEach((mount) => {
          // Options should be properly parsed for macOS format
          expect(Array.isArray(mount.options)).toBe(true);
          if (mount.options.length > 0) {
            expect(
              mount.options.some((opt) => commonOptions.includes(opt)),
            ).toBe(true);
          }
        });
      });
    });
  });
});
