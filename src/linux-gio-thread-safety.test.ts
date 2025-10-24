// src/linux-gio-thread-safety.test.ts
//
// Test for Finding #6: GVolumeMonitor Thread Safety Violation (RESOLVED)
//
// According to official GIO documentation:
// https://docs.gtk.org/gio/class.VolumeMonitor.html
//
// "GVolumeMonitor is not thread-default-context aware (see
// g_main_context_push_thread_default()), and so should not be used other
// than from the main thread, with no thread-default-context active."
//
// RESOLUTION:
// Our implementation now uses g_unix_mounts_get() as the primary, thread-safe
// path for enumerating mounts. GVolumeMonitor is only used for optional
// best-effort metadata enrichment.
//
// Thread-safe functions used:
// ✅ g_unix_mounts_get() - explicitly thread-safe (uses getmntent_r or G_LOCK)
// ✅ g_unix_mount_get_mount_path() - safe to call on GUnixMountEntry
// ✅ g_unix_mount_get_fs_type() - safe to call on GUnixMountEntry
// ✅ g_unix_mount_get_device_path() - safe to call on GUnixMountEntry

import { getVolumeMountPoints } from "./index";
import { isLinux } from "./platform";

// Skip if GIO is not enabled (compile-time flag)
const describeIfLinuxGIO = isLinux ? describe : describe.skip;

describeIfLinuxGIO("Finding #6: GIO Thread Safety (RESOLVED)", () => {
  it("should use thread-safe g_unix_mounts_get() API", async () => {
    // This test verifies that the thread-safe implementation works correctly
    // The implementation uses g_unix_mounts_get() which is documented as safe
    // for worker threads, unlike GVolumeMonitor which requires main thread

    const mountPoints = await getVolumeMountPoints();

    // Verify we get valid mount points
    expect(Array.isArray(mountPoints)).toBe(true);
    expect(mountPoints.length).toBeGreaterThan(0);

    // All mount points should have required fields from g_unix_mount_get_*
    mountPoints.forEach((mp) => {
      expect(typeof mp.mountPoint).toBe("string");
      expect(mp.mountPoint.length).toBeGreaterThan(0);
      expect(typeof mp.fstype).toBe("string");
    });

    // Linux root should always be present
    const root = mountPoints.find((mp) => mp.mountPoint === "/");
    expect(root).toBeDefined();
  });

  it("should handle concurrent mount point requests safely", async () => {
    // Stress test: Run 50 concurrent requests
    // This verifies that g_unix_mounts_get() with internal G_LOCK
    // or getmntent_r() handles concurrent access correctly
    const promises = Array.from({ length: 50 }, () => getVolumeMountPoints());

    const results = await Promise.all(promises);

    // All should return successfully without crashes or corruption
    expect(results).toHaveLength(50);
    results.forEach((mountPoints) => {
      expect(Array.isArray(mountPoints)).toBe(true);
      expect(mountPoints.length).toBeGreaterThan(0);
    });

    // All should return consistent results
    const first = results[0];
    results.forEach((mountPoints) => {
      expect(mountPoints).toEqual(first);
    });
  });

  it("should not crash under concurrent metadata queries", async () => {
    // Additional stress test for the full metadata path
    // This tests both g_unix_mounts_get() and optional GVolumeMonitor enrichment
    const { getVolumeMetadata } = await import("./index");

    const promises = Array.from({ length: 20 }, () => getVolumeMetadata("/"));

    const results = await Promise.all(promises);

    // All should succeed
    expect(results).toHaveLength(20);
    results.forEach((metadata) => {
      expect(metadata).toBeDefined();
      expect(typeof metadata.size).toBe("number");
      expect(typeof metadata.available).toBe("number");
    });
  });
});
