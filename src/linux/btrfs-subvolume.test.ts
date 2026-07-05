// src/linux/btrfs-subvolume.test.ts
//
// Integration coverage for the btrfs subvolume discriminators:
//   - mount-option tier: `subvol` / `subvolid` on MountPoint (from /proc mounts)
//   - ioctl tier: `subvolumeUuid` on VolumeMetadata (BTRFS_IOC_GET_SUBVOL_INFO)
//
// These assertions are btrfs-host-specific by nature. On non-btrfs hosts (the
// typical CI runner is ext4/overlay), the btrfs-only tests no-op and only the
// "never on non-btrfs" invariant runs. On a btrfs host (e.g. a dev box where
// `/` and `/home` are subvolumes of one filesystem), the full distinctness
// checks run.

import { getVolumeMetadata, getVolumeMountPoints } from "../index";
import { describePlatform } from "../test-utils/platform";
import type { MountPoint } from "../types/mount_point";
import type { VolumeMetadata } from "../types/volume_metadata";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describePlatform("linux")("btrfs subvolumes", () => {
  let mountPoints: MountPoint[] = [];
  let btrfs: MountPoint[] = [];

  beforeAll(async () => {
    mountPoints = await getVolumeMountPoints({ includeSystemVolumes: true });
    btrfs = mountPoints.filter((mp) => mp.fstype === "btrfs");
  });

  it("exposes subvol/subvolid on btrfs mount points (mount-option tier)", () => {
    if (btrfs.length === 0) {
      console.log("[btrfs-subvolume.test] no btrfs mounts on host; skipping");
      return;
    }
    for (const mp of btrfs) {
      expect(typeof mp.subvol).toBe("string");
      expect(mp.subvol && mp.subvol.length).toBeGreaterThan(0);
      expect(typeof mp.subvolid).toBe("number");
      expect(mp.subvolid).toBeGreaterThan(0);
    }
  });

  it("never exposes subvol/subvolid on non-btrfs mount points", () => {
    for (const mp of mountPoints.filter((m) => m.fstype !== "btrfs")) {
      expect(mp.subvol).toBeUndefined();
      expect(mp.subvolid).toBeUndefined();
    }
  });

  it("gives sibling subvolumes distinct subvolumeUuid (ioctl tier)", async () => {
    if (btrfs.length === 0) {
      console.log("[btrfs-subvolume.test] no btrfs mounts on host; skipping");
      return;
    }

    const md: VolumeMetadata[] = await Promise.all(
      btrfs.map((mp) => getVolumeMetadata(mp.mountPoint)),
    );

    const withSubvolUuid = md.filter((m) => m.subvolumeUuid != null);
    if (withSubvolUuid.length === 0) {
      // Old kernel (< 4.18) or a build without <linux/btrfs.h>: the ioctl tier
      // degrades to undefined. The mount-option tier above still works.
      console.log(
        "[btrfs-subvolume.test] BTRFS_IOC_GET_SUBVOL_INFO unavailable; " +
          "skipping ioctl-tier assertions",
      );
      return;
    }

    for (const m of withSubvolUuid) {
      // Canonical lowercase hyphenated UUID.
      expect(m.subvolumeUuid).toMatch(CANONICAL_UUID);
      // The subvolume UUID is NOT the filesystem UUID (the whole point).
      if (m.uuid != null) {
        expect(m.subvolumeUuid).not.toBe(m.uuid);
      }
    }

    // subvolumeUuid is a consistent function of the subvolume identified by
    // (filesystem uuid, subvolid). Comparing every pair within one filesystem:
    //   - the SAME subvolume (same subvolid) — e.g. one subvolume bind-mounted
    //     at several paths — MUST return the SAME subvolumeUuid;
    //   - DIFFERENT subvolumes (different subvolid) that share ONE filesystem
    //     uuid MUST return DIFFERENT subvolumeUuids. This is the bug the feature
    //     fixes.
    //
    // Asserting *global* uniqueness would be wrong: a subvolume can legitimately
    // be mounted more than once (bind mounts, container storage drivers), and
    // those mounts correctly collapse to one subvolumeUuid.
    const complete = withSubvolUuid.filter(
      (m) => m.uuid != null && m.subvolid != null,
    );
    for (const a of complete) {
      for (const b of complete) {
        if (a.uuid !== b.uuid) continue; // only compare within one filesystem
        if (a.subvolid === b.subvolid) {
          expect(a.subvolumeUuid).toBe(b.subvolumeUuid);
        } else {
          expect(a.subvolumeUuid).not.toBe(b.subvolumeUuid);
        }
      }
    }
  });
});
