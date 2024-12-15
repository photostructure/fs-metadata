/* eslint-disable @typescript-eslint/no-non-null-assertion */
// src/test-utils/assert.ts
import { isMacOS } from "../platform.js";
import type { VolumeMetadata } from "../volume_metadata.js";

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
      expect(metadata.used! + metadata.available!).toBeLessThanOrEqual(
        metadata.size!,
      );
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
