// src/linux/zfs-fsid.test.ts
//
// Integration coverage for the ZFS `fsid` field: a stable, per-dataset
// identifier read from statfs(2)'s f_fsid (the dataset's persistent fsid GUID).
//
// Host-conditional by nature. The typical CI runner has no ZFS, so the zfs-only
// tests no-op there and only the "never on non-zfs" invariant runs. On a host
// with mounted ZFS datasets, the full assertions run.

import { getVolumeMetadata, getVolumeMountPoints } from "../index";
import { describePlatform } from "../test-utils/platform";
import type { MountPoint } from "../types/mount_point";
import type { VolumeMetadata } from "../types/volume_metadata";

const HEX16 = /^[0-9a-f]{16}$/;

describePlatform("linux")("zfs fsid", () => {
  let mountPoints: MountPoint[] = [];
  let zfs: MountPoint[] = [];

  beforeAll(async () => {
    mountPoints = await getVolumeMountPoints({ includeSystemVolumes: true });
    zfs = mountPoints.filter((mp) => mp.fstype === "zfs");
  });

  it("exposes a 16-hex-char fsid on zfs datasets", async () => {
    if (zfs.length === 0) {
      console.log("[zfs-fsid.test] no zfs mounts on host; skipping");
      return;
    }
    for (const mp of zfs) {
      const m = await getVolumeMetadata(mp.mountPoint);
      expect(m.fsid).toMatch(HEX16);
    }
  });

  it("gives distinct datasets distinct fsid (and same dataset the same)", async () => {
    if (zfs.length === 0) {
      console.log("[zfs-fsid.test] no zfs mounts on host; skipping");
      return;
    }

    const md: VolumeMetadata[] = await Promise.all(
      zfs.map((mp) => getVolumeMetadata(mp.mountPoint)),
    );
    const withFsid = md.filter((m) => m.fsid != null && m.mountFrom != null);
    if (withFsid.length === 0) return;

    // fsid is a function of the dataset (its mountFrom): the same dataset — even
    // bind-mounted at several paths — yields the same fsid; distinct datasets
    // yield distinct fsids. (Global uniqueness would be wrong for duplicate
    // mounts of one dataset.)
    for (const a of withFsid) {
      for (const b of withFsid) {
        if (a.mountFrom === b.mountFrom) {
          expect(a.fsid).toBe(b.fsid);
        } else {
          expect(a.fsid).not.toBe(b.fsid);
        }
      }
    }
  });

  it("never exposes fsid on non-zfs mounts", async () => {
    // fsid is only populated where f_fsid is a stable identifier (currently zfs).
    const nonZfs = mountPoints.filter((mp) => mp.fstype !== "zfs").slice(0, 8);
    for (const mp of nonZfs) {
      const m = await getVolumeMetadata(mp.mountPoint).catch(() => undefined);
      if (m != null) expect(m.fsid).toBeUndefined();
    }
  });
});
