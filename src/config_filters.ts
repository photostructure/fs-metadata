// src/config_filters.ts

import { stat } from "node:fs/promises";
import { asyncFilter, sortByStr, uniq, uniqBy } from "./array.js";
import { compileGlob } from "./glob.js";
import { FsOptions, options } from "./options.js";
import { TypedMountPoint } from "./typed_mount_point.js";

function notBlank(s: string | undefined | null): boolean {
  return s != null && s.trim().length > 0;
}

/**
 * Filter out mount points that are excluded by the configuration.
 */
export async function filterTypedMountPoints<T extends TypedMountPoint>(
  arr: (T | undefined)[],
  overrides: Partial<FsOptions> = {},
): Promise<T[]> {
  const o = options(overrides);
  const excludedMountPoints = compileGlob(o.excludedMountPointGlobs);
  const excludedFsType = compileGlob(o.excludedFileSystemTypes);
  arr = uniqBy(
    arr.filter(
      (mp) =>
        mp != null &&
        notBlank(mp.mountPoint) &&
        !excludedMountPoints.test(mp.mountPoint) &&
        !excludedFsType.test(mp.fstype),
    ),
    (ea) => ea!.mountPoint,
  );
  arr = sortByStr(arr, (ea) => ea!.mountPoint);
  return asyncFilter(arr as T[], (ea) => exists(ea.mountPoint));
}

/**
 * @return true if `path` exists
 */
async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)) != null;
  } catch {
    return false;
  }
}

/**
 * Filter out mount points that are excluded by the configuration.
 */
export async function filterMountPoints(
  mountPoints: string[],
  overrides: Partial<FsOptions> = {},
): Promise<string[]> {
  const excludeRE = compileGlob(options(overrides).excludedMountPointGlobs);
  return asyncFilter(
    uniq(mountPoints)
      .sort()
      .filter((ea) => !excludeRE.test(ea)),
    exists,
  );
}
