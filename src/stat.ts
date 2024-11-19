// src/stat.ts

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
