// src/config_filters.ts

import { asyncFilter, sortByStr, uniq } from "./array.js";
import { compileGlob } from "./glob.js";
import { FsOptions, options } from "./options.js";
import { isDirectory } from "./stat.js";
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
): Promise<string[]> {
  const o = options(overrides);
  const excludedMountPoints = compileGlob(o.excludedMountPointGlobs);
  const excludedFsType = compileGlob(o.excludedFileSystemTypes);
  const results: T[] = arr.filter(
    (mp) =>
      mp != null &&
      notBlank(mp.mountPoint) &&
      !excludedMountPoints.test(mp.mountPoint) &&
      !excludedFsType.test(mp.fstype),
  ) as T[];
  return filterMountPoints(
    results.map((ea) => ea.mountPoint),
    o,
  );
}

/**
 * Filter out mount points that are excluded by the configuration.
 */
export async function filterMountPoints(
  mountPoints: string[],
  overrides: Partial<FsOptions> = {},
): Promise<string[]> {
  const o = options(overrides);
  const excludeRE = compileGlob(o.excludedMountPointGlobs);
  return asyncFilter(
    sortByStr(
      uniq(mountPoints.filter((ea) => !excludeRE.test(ea))),
      (ea) => ea,
    ),
    isDirectory,
  );
}
