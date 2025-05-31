// src/system_volume.test.ts

import { isSystemVolume } from "./system_volume";

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
});
