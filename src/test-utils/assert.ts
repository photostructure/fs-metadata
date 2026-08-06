// src/test-utils/assert.ts
import { isMacOS } from "../platform";
import type { VolumeMetadata } from "../types/volume_metadata";

/**
 * Asserts that the given metadata object has valid filesystem metadata
 * properties
 * @param metadata The metadata object to validate
 */
export function assertMetadata(metadata: VolumeMetadata | undefined) {
  try {
    // Basic type checks
    expect(metadata).toBeDefined();
    if (metadata == null) throw new Error("Metadata is undefined");

    expect(metadata.mountPoint).toBeDefined();
    expect(typeof metadata.mountPoint).toBe("string");
    expect(metadata.mountPoint.length).toBeGreaterThan(0);

    if (metadata.fstype !== undefined) {
      expect(typeof metadata.fstype).toBe("string");
      expect(metadata.fstype).toMatch(/^[^/]+$/);
    }

    // Size checks
    if (isMacOS && metadata.mountPoint === "/System/Volumes/Data/home") {
      // skip size checks for this path on macOS, it's for the legacy /home mount which may be empty
    } else {
      expect(metadata.size).toBeGreaterThan(0);
      expect(metadata.used).toBeGreaterThanOrEqual(0);
      expect(metadata.available).toBeGreaterThanOrEqual(0);
      // No relationship is asserted between these three. `used` derives from
      // statvfs f_bfree and `available` from f_bavail, which come from separate
      // accounting paths: btrfs subtracts its metadata/global-reserve overhead
      // from f_bfree but not f_bavail, so `used + available` exceeds `size`
      // there. Bounding each against `size` individually would be a range
      // assertion on dynamic counters, which this repo's testing guidance
      // rules out precisely because filesystem accounting varies.
    }

    // Optional fields with type checking
    if (metadata.label !== undefined) {
      expect(typeof metadata.label).toBe("string");
      expect(metadata.label.length).toBeGreaterThan(0);
    }

    if (metadata.uuid !== undefined) {
      expect(typeof metadata.uuid).toBe("string");
      expect(metadata.uuid).toMatch(/^[0-9a-z-]{8,}$/i);
    }

    if (metadata.isReadOnly !== undefined) {
      expect(typeof metadata.isReadOnly).toBe("boolean");
    }

    if (metadata.remote !== undefined) {
      expect(typeof metadata.remote).toBe("boolean");

      // If it's a remote volume, check for remote-specific properties
      if (metadata.remote === true) {
        if (metadata.remoteHost !== undefined) {
          expect(typeof metadata.remoteHost).toBe("string");
          expect(metadata.remoteHost.length).toBeGreaterThan(0);
        }

        if (metadata.remoteShare !== undefined) {
          expect(typeof metadata.remoteShare).toBe("string");
          expect(metadata.remoteShare.length).toBeGreaterThan(0);
        }
      }
    }
  } catch (e) {
    console.log("Assertions failed: " + e, { metadata });
    throw e;
  }
}
