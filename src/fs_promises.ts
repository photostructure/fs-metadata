// src/fs_promises.ts

import { type PathLike, type StatOptions, Stats } from "node:fs";
import { stat } from "node:fs/promises";

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
    await statAsync(path);
    return true;
  } catch {
    return false;
  }
}
