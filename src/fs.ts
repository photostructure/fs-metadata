// src/fs.ts

import {
  type Dir,
  type PathLike,
  type StatOptions,
  Stats,
  statSync,
} from "node:fs";
import { opendir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withTimeout } from "./async.js";

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

/**
 * @return `true` if `dir` exists and is a directory and at least one entry can be read.
 * @throws {Error} if `dir` does not exist or is not a directory or cannot be read.
 */
export async function canReaddir(
  dir: string,
  timeoutMs: number,
): Promise<true> {
  return withTimeout({
    desc: "canReaddir()",
    promise: _canReaddir(dir),
    timeoutMs,
  });
}

async function _canReaddir(dir: string): Promise<true> {
  let d: Dir | undefined = undefined;
  try {
    d = await opendir(dir);
    await d.read();
    return true;
  } finally {
    if (d != null) void d.close();
  }
}
