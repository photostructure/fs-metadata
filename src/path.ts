// src/path.ts

import { dirname, resolve, sep } from "node:path";
import { isWindows } from "./platform";
import { isBlank } from "./string";

export function normalizePath(
  mountPoint: string | undefined,
): string | undefined {
  if (isBlank(mountPoint)) return undefined;

  // Security check: reject paths with directory traversal patterns BEFORE resolving
  if (mountPoint.includes("..")) {
    throw new Error("Invalid path: contains directory traversal pattern");
  }

  // Check for invalid UTF-8 sequences by looking for common invalid patterns
  // This is a basic check - the native code will do more thorough validation
  if (mountPoint.includes("\uFFFD") || mountPoint.includes("\0")) {
    throw new Error("Invalid path: contains invalid characters");
  }

  const result = isWindows
    ? normalizeWindowsPath(mountPoint)
    : normalizePosixPath(mountPoint);

  // Make sure the native code doesn't see anything weird:
  return result != null ? resolve(result) : undefined;
}

/**
 * Normalizes a Linux or macOS mount point by removing any trailing slashes.
 * This is a no-op for root mount points.
 */
export function normalizePosixPath(
  mountPoint: string | undefined,
): string | undefined {
  if (isBlank(mountPoint)) return undefined;
  if (mountPoint === "/") return mountPoint;

  // Fast path: check last char only if no trailing slash
  if (mountPoint[mountPoint.length - 1] !== "/") return mountPoint;

  // Slower path: trim trailing slashes
  let end = mountPoint.length - 1;
  while (end > 0 && mountPoint[end] === "/") {
    end--;
  }
  return mountPoint.slice(0, end + 1);
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
  return n == null ? false : isWindows ? dirname(n) === n : n === "/";
}

/**
 * @return true if `ancestor` is the same path as `descendant`, or is a parent
 * directory of `descendant`. Both paths should be normalized/resolved.
 */
export function isAncestorOrSelf(
  ancestor: string,
  descendant: string,
): boolean {
  if (ancestor === descendant) return true;
  // Root dirs already end with sep (e.g. "/" or "C:\"); others need sep
  // appended to avoid "/home" matching "/homeother".
  const prefix = isRootDirectory(ancestor) ? ancestor : ancestor + sep;
  return descendant.startsWith(prefix);
}
