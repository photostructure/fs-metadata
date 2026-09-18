// src/linux/mount_points.ts
import { readFile } from "node:fs/promises";
import { debug } from "../debuglog";
import { toError, WrappedError } from "../error";
import { optionsWithDefaults } from "../options";
import { isAncestorOrSelf } from "../path";
import { type MountPoint } from "../types/mount_point";
import type { Options } from "../types/options";
import {
  lastMountEntriesByPath,
  MountEntry,
  mountEntryToMountPoint,
  parseMtab,
} from "./mtab";

export async function getLinuxMountPoints(
  opts?: Pick<Options, "linuxMountTablePaths">,
): Promise<MountPoint[]> {
  const o = optionsWithDefaults(opts);
  let cause: Error | undefined;
  for (const input of o.linuxMountTablePaths) {
    try {
      const mtabContent = await readFile(input, "utf8");
      const results = lastMountEntriesByPath(parseMtab(mtabContent))
        .map((ea) => mountEntryToMountPoint(ea))
        .filter((ea) => ea != null);
      debug("[getLinuxMountPoints] %s mount points: %o", input, results);
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      cause ??= toError(error);
    }
  }

  throw new WrappedError(
    `Failed to find any mount points (tried: ${JSON.stringify(o.linuxMountTablePaths)})`,
    { cause },
  );
}

/**
 * The mount entry whose mount point is the closest path ancestor of `path`.
 *
 * Only useful for a path that is not itself a mount point — see
 * {@link getLinuxMtabMetadata}. A btrfs subvolume nested inside a mounted
 * filesystem has no entry of its own, so this is the only way to reach the
 * mount facts (fstype, device, options) that apply to it.
 *
 * @return the deepest containing entry, or undefined if the mount table cannot
 * be read or names no ancestor.
 */
export async function getContainingMountEntry(
  path: string,
  opts?: Pick<Options, "linuxMountTablePaths">,
): Promise<MountEntry | undefined> {
  const inputs = optionsWithDefaults(opts).linuxMountTablePaths;
  for (const input of inputs) {
    try {
      const mtabContent = await readFile(input, "utf8");
      let best: MountEntry | undefined;
      for (const ea of lastMountEntriesByPath(parseMtab(mtabContent))) {
        if (
          isAncestorOrSelf(ea.fs_file, path) &&
          (best == null || ea.fs_file.length > best.fs_file.length)
        ) {
          best = ea;
        }
      }
      if (best != null) return best;
    } catch (error) {
      debug("[getContainingMountEntry] %s unreadable: %s", input, error);
    }
  }
  return undefined;
}

export async function getLinuxMtabMetadata(
  mountPoint: string,
  opts?: Pick<Options, "linuxMountTablePaths">,
): Promise<MountEntry> {
  let caughtError: Error | undefined;
  const inputs = optionsWithDefaults(opts).linuxMountTablePaths;
  for (const input of inputs) {
    try {
      const mtabContent = await readFile(input, "utf8");
      // lastMountEntriesByPath(): when several mounts stack on `mountPoint`,
      // the last entry is the one that describes what the caller reaches — for
      // every stacking mechanism this library targets. See its caveat.
      for (const ea of lastMountEntriesByPath(parseMtab(mtabContent))) {
        if (ea.fs_file === mountPoint) {
          return ea;
        }
      }
    } catch (error) {
      caughtError ??= toError(error);
    }
  }

  throw new WrappedError(
    `Failed to find mount point ${mountPoint} in an linuxMountTablePaths (tried: ${JSON.stringify(inputs)})`,
    caughtError,
  );
}
