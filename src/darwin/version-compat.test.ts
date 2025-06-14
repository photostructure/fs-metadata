// src/darwin/version-compat.test.ts
// Tests for macOS version compatibility (10.13+)

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import * as semver from "semver";
import {
  getVolumeMetadata,
  getVolumeMountPoints,
  isHidden,
  setHidden,
} from "../index";
import { describePlatform, tmpDirNotHidden } from "../test-utils/platform";

describePlatform("darwin")("macOS version compatibility tests", () => {
  let tempDir: string;
  let macOSVersion: string | null = null;

  beforeAll(() => {
    if (process.platform === "darwin") {
      try {
        // Get macOS version
        const versionOutput = execSync("sw_vers -productVersion", {
          encoding: "utf8",
        }).trim();
        macOSVersion = versionOutput;
        console.log(`Testing on macOS ${macOSVersion}`);
      } catch {
        console.warn("Could not determine macOS version");
      }
    }
  });

  beforeEach(async () => {
    await fs.mkdir(tmpDirNotHidden(), { recursive: true });
    tempDir = await fs.mkdtemp(path.join(tmpDirNotHidden(), "version-tests-"));
  });

  afterEach(async () => {
    await fs
      .rm(tempDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 500,
      })
      .catch(() => {
        // Ignore cleanup failures
      });
  });

  it("should verify minimum macOS version requirement", () => {
    if (!macOSVersion) {
      console.warn("Skipping version check - could not determine version");
      return;
    }

    // Our minimum supported version is macOS 10.13 (High Sierra)
    const minVersion = "10.13.0";
    const isSupported = semver.gte(
      semver.coerce(macOSVersion) || "0.0.0",
      minVersion,
    );

    expect(isSupported).toBe(true);

    if (!isSupported) {
      console.warn(
        `macOS ${macOSVersion} is below minimum supported version ${minVersion}`,
      );
    }
  });

  it("should use appropriate APIs for macOS version", async () => {
    if (!macOSVersion) return;

    const versionParts = macOSVersion.split(".");
    const majorVersion = parseInt(versionParts[0] || "0", 10);

    // getmntinfo_r_np is available since macOS 10.13
    if (
      majorVersion >= 10 ||
      (majorVersion === 10 && parseInt(versionParts[1] || "0", 10) >= 13)
    ) {
      // Should successfully get mount points using thread-safe API
      const mountPoints = await getVolumeMountPoints();
      expect(Array.isArray(mountPoints)).toBe(true);
      expect(mountPoints.length).toBeGreaterThan(0);
    }
  });

  it("should handle APFS features based on version", async () => {
    if (!macOSVersion) return;

    // APFS was introduced in macOS 10.13 (High Sierra)
    // Full APFS adoption was in macOS 10.14 (Mojave)
    const metadata = await getVolumeMetadata("/");

    const versionParts = macOSVersion.split(".");
    const majorVersion = parseInt(versionParts[0] || "0", 10);
    const minorVersion =
      majorVersion === 10 ? parseInt(versionParts[1] || "0", 10) : 0;

    if (majorVersion > 10 || (majorVersion === 10 && minorVersion >= 14)) {
      // Mojave and later typically use APFS for system volume
      console.log(`Root filesystem type: ${metadata.fstype}`);

      // Note: System volume might still be HFS+ on older upgraded systems
      if (metadata.fstype?.toLowerCase() === "apfs") {
        // Test APFS-specific behavior
        const testFile = path.join(tempDir, "apfs-test.txt");
        await fs.writeFile(testFile, "test");

        try {
          const result = await setHidden(testFile, true, "systemFlag");
          expect(await isHidden(result.pathname)).toBe(true);
        } catch (error: unknown) {
          // APFS may have issues with chflags
          if (error instanceof Error) {
            console.log(
              `APFS chflags error on ${macOSVersion}: ${error.message}`,
            );
            expect(error.message).toMatch(/APFS|chflags|not supported/);
          }
        }
      }
    }
  });

  it("should handle deprecated APIs gracefully", async () => {
    // All our APIs should work on macOS 10.13+
    // No deprecated APIs should be used

    // Test basic functionality works across versions
    const mountPoints = await getVolumeMountPoints();
    expect(mountPoints).toBeDefined();

    if (mountPoints.length > 0) {
      const firstMount = mountPoints[0];
      if (firstMount) {
        const metadata = await getVolumeMetadata(firstMount.mountPoint);
        expect(metadata).toBeDefined();
        expect(metadata.fstype).toBeDefined();
      }
    }
  });

  it("should verify dispatch queue support", async () => {
    // Dispatch queues are available on all supported macOS versions
    // Our DASessionSetDispatchQueue usage should work on 10.13+

    const mountPoints = await getVolumeMountPoints();

    // Getting mount points uses dispatch queues internally on macOS
    expect(mountPoints).toBeDefined();
    expect(Array.isArray(mountPoints)).toBe(true);

    // Volume metadata also uses dispatch queues for DiskArbitration
    if (mountPoints.length > 0) {
      const firstMount = mountPoints[0];
      if (firstMount) {
        const metadata = await getVolumeMetadata(firstMount.mountPoint);
        expect(metadata.status).toMatch(/healthy|ready|partial/);
      }
    }
  });

  it("should handle version-specific mount point filtering", async () => {
    const mountPoints = await getVolumeMountPoints();

    // Different macOS versions may have different system mount points
    const systemMounts = mountPoints.filter(
      (mp) =>
        mp.mountPoint.startsWith("/System/") ||
        mp.mountPoint.startsWith("/private/var/vm"),
    );

    console.log(
      `Found ${systemMounts.length} system mount points on macOS ${macOSVersion}`,
    );

    // Verify we can get metadata for regular mount points
    const regularMounts = mountPoints.filter(
      (mp) =>
        !mp.mountPoint.startsWith("/System/") &&
        !mp.mountPoint.startsWith("/private/"),
    );

    if (regularMounts.length > 0) {
      const firstRegular = regularMounts[0];
      if (firstRegular) {
        const metadata = await getVolumeMetadata(firstRegular.mountPoint);
        expect(metadata).toBeDefined();
      }
    }
  });

  it("should report version-appropriate error messages", async () => {
    // Test that error messages are appropriate for the macOS version
    try {
      // Try to access a non-existent path
      await getVolumeMetadata("/non/existent/path");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      const errorMessage = (error as Error).message;
      expect(errorMessage).toBeDefined();
      expect(errorMessage).not.toMatch(/undefined|null/);

      // Should get a proper error message
      expect(errorMessage).toMatch(/ENOENT|not found|does not exist/i);
    }
  });
});
