// src/system_volume.test.ts

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
        expect(isSystemVolume("C:", "NTFS")).toBe(true);
        expect(isSystemVolume("D:", "NTFS")).toBe(false);
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

  it("should override isSystemVolume on non-Windows", () => {
    if (!isWindows) {
      const mp: MountPoint = {
        mountPoint: "/home",
        fstype: "ext4",
        isSystemVolume: true,
      };
      assignSystemVolume(mp, {});
      expect(mp.isSystemVolume).toBe(false);
    }
  });
});
