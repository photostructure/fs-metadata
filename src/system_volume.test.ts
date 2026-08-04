// src/system_volume.test.ts

import { SystemFsTypesDefault } from "./options";
import { isWindows } from "./platform";
import { assignSystemVolume, isSystemVolume } from "./system_volume";
import type { MountPoint } from "./types/mount_point";

describe("isSystemVolume", () => {
  for (const { mountPoint, fstype, expected } of [
    { mountPoint: "/", fstype: "ext4", expected: false },
    { mountPoint: "/boot", fstype: "vfat", expected: true },
    { mountPoint: "/proc", fstype: "proc", expected: true },
    { mountPoint: "/dev/pts", fstype: "devpts", expected: true },
    { mountPoint: "/home", fstype: "ext4", expected: false },
    { mountPoint: "/sys", fstype: "sysfs", expected: true },
    { mountPoint: "/run/snapd/ns", fstype: "tmpfs", expected: true },
    { mountPoint: "/mnt/usb", fstype: "ntfs", expected: false },
    {
      mountPoint: "/dev/hugepages/mnt/usb",
      fstype: "hugetlbfs",
      expected: true,
    },
    { mountPoint: "/sys/fs/cgroup", fstype: "cgroup2", expected: true },
    { mountPoint: "/sys/fs/bpf", fstype: "bpf", expected: true },
    { mountPoint: "/mnt/remote/nas/#snapshot", fstype: "cifs", expected: true },
    // Container runtime paths (Docker, containerd, Podman)
    {
      mountPoint: "/run/docker/netns/180b04c7697a",
      fstype: "nsfs",
      expected: true,
    },
    {
      mountPoint: "/var/lib/docker/overlay2/abc123/merged",
      fstype: "overlay",
      expected: true,
    },
    {
      mountPoint: "/run/containerd/io.containerd.runtime.v2.task/k8s.io/abc",
      fstype: "tmpfs",
      expected: true,
    },
    {
      mountPoint: "/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs",
      fstype: "ext4",
      expected: true,
    },
    {
      mountPoint: "/run/containers/storage/overlay-containers",
      fstype: "tmpfs",
      expected: true,
    },
    {
      mountPoint: "/var/lib/containers/storage/overlay",
      fstype: "ext4",
      expected: true,
    },
  ]) {
    it(`should return ${expected} for ${mountPoint} (${fstype})`, () => {
      expect(isSystemVolume(mountPoint, fstype)).toBe(expected);
    });
  }

  it("should handle undefined fstype", () => {
    expect(isSystemVolume("/mnt/data", undefined)).toBe(false);
    expect(isSystemVolume("/proc/cpuinfo", undefined)).toBe(true); // path pattern match
  });

  it("should handle empty fstype", () => {
    expect(isSystemVolume("/mnt/data", "")).toBe(false);
    expect(isSystemVolume("/boot", "")).toBe(true); // path pattern match
  });

  if (!isWindows) {
    it("keeps POSIX system-path matching case-sensitive", () => {
      expect(isSystemVolume("/tmp", "ext4")).toBe(true);
      expect(isSystemVolume("/TMP", "ext4")).toBe(false);
    });
  }

  describe("fstype matching is exact, not glob", () => {
    // SystemFsTypesDefault used to carry a "snap*" entry that never matched
    // anything: isSystemVolume() compares fstypes with Array.includes(), while
    // only systemPathPatterns goes through compileGlob(). Snap mounts are
    // covered by their real fstypes and mount roots instead — every one of
    // which is enumerated in the two tests below.
    it("carries no glob metacharacters in SystemFsTypesDefault", () => {
      expect(SystemFsTypesDefault.filter((ea) => /[*?]/.test(ea))).toEqual([]);
    });

    it("does not treat a '*' in systemFsTypes as a wildcard", () => {
      const config = { systemFsTypes: ["snap*"], systemPathPatterns: [] };
      expect(isSystemVolume("/mnt/data", "snapfuse", config)).toBe(false);
      expect(isSystemVolume("/mnt/data", "squashfs", config)).toBe(false);
      // ...only the literal string matches:
      expect(isSystemVolume("/mnt/data", "snap*", config)).toBe(true);
    });

    // Each rule is asserted with the other disabled: a snap mount matches both
    // the /snap/** path and the squashfs fstype, so testing them together lets
    // either one alone carry the assertion and hides a gap in the other.
    it("classifies every snapd fstype without help from the path rule", () => {
      const noPaths = { systemPathPatterns: [] };
      // The kernel driver, used everywhere outside a container:
      expect(isSystemVolume("/mnt/x", "squashfs", noPaths)).toBe(true);
      // Inside a container with /dev/fuse and a helper binary, snapd uses FUSE
      // instead, preferring squashfuse over snapfuse — so both must be listed:
      expect(isSystemVolume("/mnt/x", "fuse.squashfuse", noPaths)).toBe(true);
      expect(isSystemVolume("/mnt/x", "fuse.snapfuse", noPaths)).toBe(true);
    });

    it("classifies both snap mount roots without help from the fstype rule", () => {
      const noFsTypes = { systemFsTypes: [] };
      expect(isSystemVolume("/snap/core24/1587", "ext4", noFsTypes)).toBe(true);
      // snapd's AltSnapMountDir, used where /snap is absent or a symlink to it:
      expect(
        isSystemVolume("/var/lib/snapd/snap/core24/1587", "ext4", noFsTypes),
      ).toBe(true);
    });
  });

  it("should handle custom config", () => {
    const config = {
      systemFsTypes: ["customfs"],
      systemPathPatterns: ["**/custom/**"],
    };
    expect(isSystemVolume("/mnt/data", "customfs", config)).toBe(true);
    expect(isSystemVolume("/mnt/custom/data", "ext4", config)).toBe(true);
    expect(isSystemVolume("/mnt/data", "ext4", config)).toBe(false);
  });

  if (isWindows) {
    it("should detect Windows system drive", () => {
      const originalSystemDrive = process.env["SystemDrive"];
      try {
        process.env["SystemDrive"] = "C:";
        expect(isSystemVolume("C:\\", "NTFS")).toBe(true);
        expect(isSystemVolume("D:\\", "NTFS")).toBe(false);
      } finally {
        if (originalSystemDrive !== undefined) {
          process.env["SystemDrive"] = originalSystemDrive;
        } else {
          delete process.env["SystemDrive"];
        }
      }
    });
  }
});

describe("assignSystemVolume", () => {
  it("should assign isSystemVolume to mount point", () => {
    const mp: MountPoint = {
      mountPoint: "/proc",
      fstype: "proc",
    };
    assignSystemVolume(mp, {});
    expect(mp.isSystemVolume).toBe(true);
  });

  it("should respect existing isSystemVolume on Windows", () => {
    if (isWindows) {
      const mp: MountPoint = {
        mountPoint: "D:",
        fstype: "NTFS",
        isSystemVolume: true,
      };
      assignSystemVolume(mp, {});
      expect(mp.isSystemVolume).toBe(true);
    }
  });

  it("should preserve native isSystemVolume=true on all platforms", () => {
    // Native code may mark volumes as system (e.g., macOS MNT_SNAPSHOT,
    // Windows system drive). assignSystemVolume should never downgrade
    // a native true to false.
    const mp: MountPoint = {
      mountPoint: "/home",
      fstype: "ext4",
      isSystemVolume: true,
    };
    assignSystemVolume(mp, {});
    expect(mp.isSystemVolume).toBe(true);
  });
});
