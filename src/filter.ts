// src/filter.ts

import { stat } from "node:fs/promises";
import { asyncFilter, uniq } from "./Array.js";
import { getConfig } from "./Config.js";
import { compileGlob } from "./Glob.js";
import { TypedMountPoint } from "./TypedMountPoint.js";

export function filterTypedMountPoints<T extends TypedMountPoint>(
  arr: T[],
  config = getConfig(),
): T[] {
  const excludedRE = compileGlob(config.excludedFileSystemTypes);
  return arr.filter((mp) => !excludedRE.test(mp.fstype));
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
export async function filterMountPoints(
  mountPoints: string[],
  config = getConfig(),
): Promise<string[]> {
  const excludeRE = compileGlob(config?.excludedMountPointGlobs);
  return asyncFilter(
    uniq(mountPoints)
      .sort()
      .filter((ea) => !excludeRE.test(ea)),
    exists,
  );
}
