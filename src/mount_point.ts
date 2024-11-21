import { isWindows } from "./platform.js";
import { toNotBlank } from "./string.js";

export function normalizeMountPoint(mountPoint: string): string {
  const result = isWindows
    ? normalizeWindowsMountPoint(mountPoint)
    : normalizeLinuxMountPoint(mountPoint);

  // We DO NOT resolve() this path here -- that's too clever by half.
  return result;
}

/**
 * Normalizes a Linux mount point by removing any trailing slashes. This is a
 * no-op for root mount points.
 */
export function normalizeLinuxMountPoint(mountPoint: string): string {
  return toNotBlank(mountPoint.replace(/\/+$/, "")) ?? "/";
}

/**
 * Normalizes a Windows mount point by ensuring drive letters end with a
 * backslash.
 */
export function normalizeWindowsMountPoint(mountPoint: string): string {
  // Terrible things happen if we give syscalls "C:" instead of "C:\"

  return /^[a-z]:$/i.test(mountPoint)
    ? mountPoint.toUpperCase() + "\\"
    : mountPoint;
}
