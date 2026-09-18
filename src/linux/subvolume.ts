// src/linux/subvolume.ts

import { dirname } from "node:path";
import { debug } from "../debuglog";
import { statAsync, statfsAsync } from "../fs";
import { isAncestorOrSelf } from "../path";

/**
 * `statfs(2)`'s `f_type` for btrfs (`BTRFS_SUPER_MAGIC`). Node exposes it as
 * `StatsFs.type`, so a path can be identified as btrfs without a mount table
 * lookup or a native call.
 */
export const BtrfsSuperMagic = 0x9123683e;

/**
 * `BTRFS_FIRST_FREE_OBJECTID`: the inode number of the root directory of every
 * btrfs subvolume, including the top-level tree (id 5). No other directory in a
 * subvolume has it, so `st_ino === 256` identifies a subvolume root exactly.
 */
export const BtrfsSubvolumeRootInode = 256;

/**
 * @return true if `path` is on a btrfs filesystem.
 *
 * Used as corroboration before resolving a path whose device matches no mount
 * entry: only btrfs puts a filesystem on an anonymous device that the mount
 * table does not name (a nested subvolume). Fails closed — an unreadable path
 * is not treated as btrfs.
 */
export async function isBtrfsPath(
  path: string,
  statfsImpl: typeof statfsAsync = statfsAsync,
): Promise<boolean> {
  try {
    return (await statfsImpl(path)).type === BtrfsSuperMagic;
  } catch (err) {
    debug("[isBtrfsPath] statfs failed for %s: %s", path, err);
    return false;
  }
}

/**
 * Find the directory where the btrfs subvolume containing `path` begins.
 *
 * Walks up from `path` (or its parent directory, if `path` is not a directory)
 * to `mountPoint` inclusive, and returns the first directory that is a
 * subvolume root ({@link BtrfsSubvolumeRootInode}) on the same device.
 *
 * The walk never goes above `mountPoint`: the subvolume root of a bind-mounted
 * *subdirectory* is not reachable through that mount, and the directory above
 * a file bind mount belongs to a different filesystem entirely. Both cases
 * return undefined — the subvolume's UUID is still readable, but no path under
 * this mount is its root.
 *
 * @param path an absolute, resolved path at or below `mountPoint`
 * @param mountPoint the mount table entry that contains `path`
 */
export async function findSubvolumeRoot(
  path: string,
  mountPoint: string,
  statImpl: typeof statAsync = statAsync,
): Promise<string | undefined> {
  let current: string;
  let dev: number;
  try {
    const s = await statImpl(path);
    // The subvolume ioctl needs a directory descriptor, and a file's subvolume
    // is its directory's.
    current = s.isDirectory() ? path : dirname(path);
    dev = s.dev;
  } catch (err) {
    debug("[findSubvolumeRoot] stat failed for %s: %s", path, err);
    return undefined;
  }

  if (!isAncestorOrSelf(mountPoint, current)) return undefined;

  for (;;) {
    try {
      const s = await statImpl(current);
      // A different device means we left the subvolume we started in.
      if (s.dev !== dev) return undefined;
      if (s.ino === BtrfsSubvolumeRootInode) return current;
    } catch (err) {
      debug("[findSubvolumeRoot] stat failed for %s: %s", current, err);
      return undefined;
    }
    const parent = dirname(current);
    if (current === mountPoint || parent === current) return undefined;
    current = parent;
  }
}
