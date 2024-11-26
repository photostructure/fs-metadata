// src/config_filters.ts

import { asyncFilter, uniq } from "./array.js";
import { isDirectory } from "./fs.js";
import { compileGlob } from "./glob.js";
import { type Options, options } from "./options.js";
import { isNotBlank, isString, sortByLocale } from "./string.js";
import {
  isTypedMountPoint,
  type TypedMountPoint,
} from "./typed_mount_point.js";

/**
 * Filter out mount points that are excluded by the configuration.
 */
export async function filterTypedMountPoints<T extends TypedMountPoint>(
  arr: (T | string | undefined)[],
  overrides: Partial<Options> = {},
): Promise<string[]> {
  const o = options(overrides);
  const excludedFsType = compileGlob(o.excludedFileSystemTypes);
  const typedArr = arr.filter((mp) => {
    return isTypedMountPoint(mp) && !excludedFsType.test(mp.fstype);
  }) as T[];

  return filterMountPoints(
    [...typedArr.map((ea) => ea.mountPoint), ...arr.filter(isString)],
    o,
  );
}

/**
 * Filter out mount points that are excluded by the configuration.
 */
export async function filterMountPoints(
  arr: (TypedMountPoint | string | undefined)[],
  overrides: Partial<Options> = {},
): Promise<string[]> {
  const o = options(overrides);
  const excludeRE = compileGlob(o.excludedMountPointGlobs);
  const mountPoints = arr
    .map((ea) =>
      typeof ea === "string"
        ? ea
        : isTypedMountPoint(ea)
          ? ea.mountPoint
          : undefined,
    )
    .filter(isNotBlank)
    .filter((ea) => !excludeRE.test(ea));
  const result = uniq(sortByLocale(mountPoints));
  return o.onlyDirectories ? asyncFilter(result, isDirectory) : result;
}
