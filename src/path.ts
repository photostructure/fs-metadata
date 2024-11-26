import { dirname, resolve } from "node:path";
import { isWindows } from "./platform.js";
import { toNotBlank } from "./string.js";

export function normalizePath(mountPoint: string): string {
  const result = isWindows
    ? normalizeWindowsPath(mountPoint)
    : normalizeLinuxPath(mountPoint);

  // Make sure the native code doesn't see anything weird:
  return resolve(result);
}

/**
 * Normalizes a Linux mount point by removing any trailing slashes. This is a
 * no-op for root mount points.
 */
export function normalizeLinuxPath(mountPoint: string): string {
  return toNotBlank(mountPoint.replace(/\/+$/, "")) ?? "/";
}

/**
 * Normalizes a Windows mount point by ensuring drive letters end with a
 * backslash.
 */
export function normalizeWindowsPath(mountPoint: string): string {
  // Terrible things happen if we give syscalls "C:" instead of "C:\"

  return /^[a-z]:$/i.test(mountPoint)
    ? mountPoint.toUpperCase() + "\\"
    : mountPoint;
}

/**
 * @return true if `path` is the root directory--this is platform-specific. Only
 * "/" on linux/macOS is considered a root directory. On Windows, the root
 * directory is a drive letter followed by a colon, e.g. "C:\".
 */
export function isRootDirectory(path: string): boolean {
  const n = normalizePath(path);
  return isWindows ? dirname(n) === n : n === "/";
}
