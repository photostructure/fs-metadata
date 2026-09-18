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

import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  getMountPointForPath,
  getVolumeMetadata,
  getVolumeMetadataForPath,
  getVolumeMountPoints,
} from "../index";
import { describePlatform } from "../test-utils/platform";
import type { MountPoint } from "../types/mount_point";
import type { VolumeMetadata } from "../types/volume_metadata";
import { getLinuxMountPoints } from "./mount_points";
import { BtrfsSubvolumeRootInode } from "./subvolume";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const execFileAsync = promisify(execFile);

/**
 * Immediate child directories of `mountPoint` that are btrfs subvolumes with no
 * mount entry of their own: a subvolume root always has inode 256
 * (`BTRFS_FIRST_FREE_OBJECTID`), and a nested one has its own anonymous st_dev.
 *
 * Read-only discovery on purpose. Creating a fixture would work, but removing
 * it needs CAP_SYS_ADMIN or the `user_subvol_rm_allowed` mount option (see
 * btrfs-subvolume(8)), which an arbitrary host will not have — so a test that
 * created one could not clean up after itself.
 */
async function nestedSubvolumes(
  mountPoint: string,
  mountPointPaths: Set<string>,
): Promise<string[]> {
  const mountDev = (await stat(mountPoint)).dev;
  const found: string[] = [];
  for (const entry of await readdir(mountPoint, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(mountPoint, entry.name);
    // Never touch a child that is itself a mount point: it is not nested, and
    // an unreachable one (a dead automount) would block stat() for seconds.
    if (mountPointPaths.has(path)) continue;
    try {
      const s = await stat(path);
      if (s.ino === BtrfsSubvolumeRootInode && s.dev !== mountDev) {
        found.push(path);
      }
    } catch {
      // unreadable child: not usable as a fixture
    }
  }
  return found;
}

/** `true`/`false` from `btrfs property get -ts <path> ro`, or undefined. */
async function readOnlyProperty(path: string): Promise<boolean | undefined> {
  try {
    const { stdout } = await execFileAsync("btrfs", [
      "property",
      "get",
      "-ts",
      path,
      "ro",
    ]);
    const m = /^ro=(true|false)$/m.exec(stdout.trim());
    return m == null ? undefined : m[1] === "true";
  } catch {
    // btrfs-progs absent or the property is unreadable
    return undefined;
  }
}

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

// A subvolume nested inside a mounted btrfs filesystem has its own anonymous
// st_dev but no mount-table entry of its own. These assertions need a host that
// actually has one; the injected-fake unit tests in ./nested-subvolume.test.ts
// cover the resolution logic everywhere else.
describePlatform("linux")("nested btrfs subvolumes", () => {
  let mount: MountPoint | undefined;
  let mountMetadata: VolumeMetadata | undefined;
  let nested: string[] = [];
  // From the RAW mount table: public enumeration omits file mount targets, and
  // a file or directory that is itself a mount has its own identity rather than
  // its parent subvolume's.
  let mountPointPaths = new Set<string>();

  beforeAll(async () => {
    const mountPoints = await getVolumeMountPoints({
      includeSystemVolumes: true,
    });
    const paths = new Set(mountPoints.map((mp) => mp.mountPoint));
    mountPointPaths = new Set(
      (await getLinuxMountPoints().catch(() => [])).map((mp) => mp.mountPoint),
    );
    for (const p of paths) mountPointPaths.add(p);
    for (const mp of mountPoints.filter((m) => m.fstype === "btrfs")) {
      const found = await nestedSubvolumes(mp.mountPoint, paths).catch(
        () => [] as string[],
      );
      if (found.length > 0) {
        mount = mp;
        nested = found;
        mountMetadata = await getVolumeMetadata(mp.mountPoint);
        return;
      }
    }
  });

  /** @return false (with a note) when the host cannot exercise this. */
  function hasFixture(): boolean {
    if (mount == null || mountMetadata?.subvolumeUuid == null) {
      console.log(
        "[btrfs-subvolume.test] no nested btrfs subvolume (or no " +
          "BTRFS_IOC_GET_SUBVOL_INFO) on host; skipping",
      );
      return false;
    }
    return true;
  }

  it("resolves a nested subvolume to its containing mount", async () => {
    if (!hasFixture()) return;
    for (const path of nested) {
      // Both used to throw "No mount point found for path".
      await expect(getMountPointForPath(path)).resolves.toBe(mount?.mountPoint);
      const md = await getVolumeMetadataForPath(path);
      expect(md.mountPoint).toBe(mount?.mountPoint);
      // Same filesystem, so the same block-device uuid and mountFrom.
      expect(md.uuid).toBe(mountMetadata?.uuid);
      expect(md.mountFrom).toBe(mountMetadata?.mountFrom);
    }
  });

  it("reports the subvolume's own identity, not the mount's", async () => {
    if (!hasFixture()) return;
    for (const path of nested) {
      for (const md of [
        await getVolumeMetadataForPath(path),
        await getVolumeMetadata(path),
      ]) {
        expect(md.subvolumeRoot).toBe(path);
        expect(md.subvolumeUuid).toMatch(CANONICAL_UUID);
        expect(md.subvolumeUuid).not.toBe(mountMetadata?.subvolumeUuid);
        expect(md.subvolumeUuid).not.toBe(md.uuid);
        expect(typeof md.subvolid).toBe("number");
        expect(md.subvolid).not.toBe(mountMetadata?.subvolid);
        // There is no subvol= mount option for a subvolume that is not
        // mounted, and the containing mount's must not leak through.
        expect(md.subvol).toBeUndefined();
      }
    }
  });

  it("gives sibling nested subvolumes distinct identity", async () => {
    if (!hasFixture() || nested.length < 2) return;
    const md = await Promise.all(nested.map((p) => getVolumeMetadata(p)));
    const uuids = md.map((m) => m.subvolumeUuid);
    expect(new Set(uuids).size).toBe(uuids.length);
    const ids = md.map((m) => m.subvolid);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports a read-only subvolume as read-only", async () => {
    if (!hasFixture()) return;
    let checked = 0;
    for (const path of nested) {
      // The mount is read-write in every fixture that reaches here, so
      // isReadOnly can only be right if it comes from the subvolume itself.
      const subvolumeIsReadOnly = await readOnlyProperty(path);
      if (subvolumeIsReadOnly == null) continue;
      checked++;
      // isReadOnly is the OR of the two: a read-write subvolume under a
      // read-only mount is still read-only. Asserting the subvolume's own flag
      // alone fails against correct behavior whenever the host's fixture
      // happens to sit under a read-only mount.
      expect((await getVolumeMetadata(path)).isReadOnly).toBe(
        (mountMetadata?.isReadOnly ?? false) || subvolumeIsReadOnly,
      );
    }
    if (checked === 0) {
      console.log(
        "[btrfs-subvolume.test] btrfs property get unavailable; " +
          "skipping isReadOnly cross-check",
      );
    }
  });

  it("attributes a path inside a nested subvolume to that subvolume", async () => {
    if (!hasFixture()) return;
    for (const path of nested) {
      const children = await readdir(path, { withFileTypes: true }).catch(
        () => [],
      );
      // The child must be an ordinary directory of THIS subvolume. Skip a
      // nested subvolume root (st_ino 256) and any mount target — a
      // bind-mounted subdirectory has an ordinary inode but its own mount
      // boundary, so its identity correctly belongs to that mount, not to the
      // parent asserted below. Matching st_dev covers both.
      const parentDev = (await stat(path)).dev;
      let childPath: string | undefined;
      for (const e of children) {
        if (!e.isDirectory()) continue;
        const candidate = join(path, e.name);
        if (mountPointPaths.has(candidate)) continue;
        const s = await stat(candidate).catch(() => undefined);
        if (
          s != null &&
          s.ino !== BtrfsSubvolumeRootInode &&
          s.dev === parentDev
        ) {
          childPath = candidate;
          break;
        }
      }
      if (childPath == null) continue;
      const md = await getVolumeMetadataForPath(childPath);
      // The identity belongs to the subvolume, not to the queried path.
      expect(md.subvolumeRoot).toBe(path);
      expect(md.subvolumeUuid).toBe(
        (await getVolumeMetadata(path)).subvolumeUuid,
      );
      return;
    }
  });

  it("reports the same identity for a file whether asked directly or by path", async () => {
    if (!hasFixture()) return;
    for (const path of nested) {
      const entries = await readdir(path, { withFileTypes: true }).catch(
        () => [],
      );
      // A file that is itself a bind-mount target is its own volume: its
      // subvolumeRoot is correctly undefined, not the enclosing subvolume.
      const file = entries.find(
        (e) => e.isFile() && !mountPointPaths.has(join(path, e.name)),
      );
      if (file == null) continue;
      const filePath = join(path, file.name);
      const direct = await getVolumeMetadata(filePath);
      const viaPath = await getVolumeMetadataForPath(filePath);
      // The subvolume ioctl needs a directory, so a file has to be probed
      // through its parent. Without that, the direct call silently drops the
      // subvolume identity and the subvolume's read-only flag that the
      // path-based call returns for the very same file.
      expect(direct.subvolumeUuid).toBe(viaPath.subvolumeUuid);
      expect(direct.subvolid).toBe(viaPath.subvolid);
      expect(direct.isReadOnly).toBe(viaPath.isReadOnly);
      expect(direct.subvolumeRoot).toBe(path);
      return;
    }
  });

  it("sets subvolumeRoot to the mount point for an ordinary btrfs mount", async () => {
    if (!hasFixture()) return;
    // The field is set whenever it is known, so consumers can always use
    // relative(subvolumeRoot, path) without a mountPoint fallback.
    expect(mountMetadata?.subvolumeRoot).toBe(mount?.mountPoint);
  });
});
