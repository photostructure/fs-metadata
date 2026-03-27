// src/mount_point_for_path.test.ts

import { join } from "node:path";
import { _dirname } from "./dirname";
import {
  getMountPointForPath,
  getVolumeMetadataForPath,
  getVolumeMountPoints,
} from "./index";
import { isMacOS } from "./platform";
import { systemDrive } from "./test-utils/platform";

const rootPath = systemDrive();
const thisDir = _dirname();
const thisFile = join(thisDir, "mount_point_for_path.test.ts");

describe("getMountPointForPath()", () => {
  it("returns a non-blank string for __dirname", async () => {
    const mountPoint = await getMountPointForPath(thisDir);
    expect(typeof mountPoint).toBe("string");
    expect(mountPoint.length).toBeGreaterThan(0);
  });

  it("returns a non-blank string for a file path", async () => {
    const mountPoint = await getMountPointForPath(thisFile);
    expect(typeof mountPoint).toBe("string");
    expect(mountPoint.length).toBeGreaterThan(0);
  });

  it("returns a non-blank string for the system drive", async () => {
    const mountPoint = await getMountPointForPath(rootPath);
    expect(typeof mountPoint).toBe("string");
    expect(mountPoint.length).toBeGreaterThan(0);
  });

  it("returns a mount point that matches a known volume", async () => {
    const mountPoint = await getMountPointForPath(thisDir);
    const mountPoints = await getVolumeMountPoints({
      includeSystemVolumes: true,
    });
    const known = mountPoints.map((mp) => mp.mountPoint);
    expect(known).toContain(mountPoint);
  });

  it("matches getVolumeMetadataForPath().mountPoint", async () => {
    const mountPoint = await getMountPointForPath(thisDir);
    const metadata = await getVolumeMetadataForPath(thisDir);
    expect(mountPoint).toBe(metadata.mountPoint);
  });

  it("throws TypeError for null pathname", async () => {
    await expect(
      getMountPointForPath(null as unknown as string),
    ).rejects.toThrow(/Invalid pathname/);
  });

  it("throws TypeError for empty pathname", async () => {
    await expect(getMountPointForPath("")).rejects.toThrow(/Invalid pathname/);
  });

  it("throws for a non-existent path", async () => {
    await expect(
      getMountPointForPath(join(rootPath, "nonexistent-path-xyz-123")),
    ).rejects.toThrow();
  });

  if (isMacOS) {
    it("resolves APFS firmlinks (/Users should not resolve to /)", async () => {
      const mountPoint = await getMountPointForPath("/Users");
      // Firmlink resolution: /Users should resolve to the Data volume, not /
      expect(mountPoint).not.toBe("/");
    });
  }

  if (!isMacOS) {
    // mountPoints option is only used on Linux/Windows (macOS uses native fstatfs)
    describe("with mountPoints option", () => {
      it("uses pre-fetched mount points instead of querying the system", async () => {
        const mountPoints = await getVolumeMountPoints({
          includeSystemVolumes: true,
        });
        const mountPoint = await getMountPointForPath(thisDir, { mountPoints });
        expect(typeof mountPoint).toBe("string");
        expect(mountPoint.length).toBeGreaterThan(0);
        // Should match what we get without the option
        const expected = await getMountPointForPath(thisDir);
        expect(mountPoint).toBe(expected);
      });

      it("works for getVolumeMetadataForPath too", async () => {
        const mountPoints = await getVolumeMountPoints({
          includeSystemVolumes: true,
        });
        const metadata = await getVolumeMetadataForPath(thisDir, {
          mountPoints,
        });
        const expected = await getVolumeMetadataForPath(thisDir);
        expect(metadata.mountPoint).toBe(expected.mountPoint);
      });
    });
  }
});
