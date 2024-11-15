// src/stat.ts

import { stat } from "node:fs/promises";

/**
 * @return true if `path` exists and is a directory
 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path))?.isDirectory() === true;
  } catch {
    return false;
  }
}
