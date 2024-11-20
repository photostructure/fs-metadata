// src/stat.ts

import { join, resolve } from "node:path";
import { statAsync } from "./fs_promises.js";

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
