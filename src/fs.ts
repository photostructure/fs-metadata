// src/fs.ts

import { type PathLike, type StatOptions, Stats, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Wrapping node:fs/promises.stat() so we can mock it in tests.
 */
export async function statAsync(
  path: PathLike,
  options?: StatOptions & { bigint?: false },
): Promise<Stats> {
  return stat(path, options);
}

export async function canStatAsync(path: string): Promise<boolean> {
  try {
    return null != (await statAsync(path));
  } catch {
    return false;
  }
}

/**
 * @return true if `path` exists and is a directory
 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await statAsync(path))?.isDirectory() === true;
  } catch {
    return false;
  }
}

/**
 * @return the first directory containing `file` or an empty string
 */
export async function findAncestorDir(
  dir: string,
  file: string,
): Promise<string | undefined> {
  dir = resolve(dir);
  try {
    const s = await statAsync(join(dir, file));
    if (s.isFile()) return dir;
  } catch {
    // fall through
  }
  const parent = resolve(dir, "..");
  return parent === dir ? undefined : findAncestorDir(parent, file);
}

export function existsSync(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false }) != null;
}
