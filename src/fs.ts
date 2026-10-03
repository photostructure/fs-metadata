// src/fs.ts

import {
  type PathLike,
  type StatOptions,
  Stats,
  type StatsFs,
  statSync,
} from "node:fs";
import { opendir, stat, statfs } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withTimeout } from "./async";

/**
 * Wrapping node:fs/promises.stat() so we can mock it in tests.
 */
export async function statAsync(
  path: PathLike,
  // `throwIfNoEntry?: true` selects the overload that resolves to
  // Promise<Stats> rather than Promise<Stats | undefined>; this wrapper always
  // throws (rather than returning undefined) when the path doesn't exist.
  options?: StatOptions & { bigint?: false; throwIfNoEntry?: true },
): Promise<Stats> {
  return stat(path, options);
}

/**
 * Wrapping node:fs/promises.statfs() so we can mock it in tests.
 *
 * `StatsFs.type` is the filesystem's magic number (`statfs(2)`'s `f_type` on
 * Linux), which identifies the filesystem without a mount table lookup.
 */
export async function statfsAsync(path: PathLike): Promise<StatsFs> {
  return statfs(path);
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
  return canReaddirObservation(dir, timeoutMs).value;
}

/**
 * Raw `opendir()` probes that have not settled yet, keyed by directory.
 *
 * A timeout abandons a probe but cannot cancel it: on a hung mount the libuv
 * worker stays parked until the kernel returns. Later probes of the same path
 * join the running one instead of parking another worker, so repeated polling
 * holds at most one worker per hung path. The macOS native probe does the same
 * (src/darwin/volume_mount_points.cpp).
 */
const pendingReaddirProbes = new Map<string, Promise<true>>();

/**
 * A directory probe and the underlying filesystem work it time-bounds.
 *
 * `settled` is shared by every concurrent observation of `dir`.
 */
export function canReaddirObservation(
  dir: string,
  timeoutMs: number,
): { value: Promise<true>; settled: Promise<true> } {
  let settled = pendingReaddirProbes.get(dir);
  if (settled == null) {
    settled = _canReaddir(dir);
    pendingReaddirProbes.set(dir, settled);
    const forget = () => pendingReaddirProbes.delete(dir);
    settled.then(forget, forget);
  }
  const value = withTimeout({
    desc: "canReaddir()",
    promise: settled,
    timeoutMs,
  });
  return { value, settled };
}

async function _canReaddir(dir: string): Promise<true> {
  await (await opendir(dir)).close();
  return true;
}
