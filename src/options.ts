// src/options.ts

import { isObject } from "./object.js";
import { isWindows } from "./platform.js";

/**
 * Configuration options for filesystem operations.
 */
export interface FsOptions {
  /**
   * Timeout in milliseconds for filesystem operations. Disable timeouts by
   * setting this to 0.
   *
   * Default is 5000ms (5 seconds) on macOS and Linux, and 15000ms (15 seconds)
   * on Windows.
   */
  timeoutMs: number;

  /**
   * File system types to exclude when listing mount points. Only applied on
   * Linux and macOS systems.
   *
   * Default values exclude "proc", "cgroup", and other non-physical
   * filesystems.
   */
  excludedFileSystemTypes: string[];

  /**
   * Glob patterns to exclude when listing mount points.
   *
   * POSIX forward-slashed pathnames will work on all platforms.
   *
   * Default values exclude common system directories.
   */
  excludedMountPointGlobs: string[];
}

/**
 * Default timeout in milliseconds for {@link FsOptions}.
 */
export const TimeoutMsDefault = isWindows ? 15_000 : 5_000;

/**
 * Default excluded file system types for {@link FsOptions}.
 *
 * Note that these are only applied on Linux and macOS systems.
 */
export const ExcludedFileSystemTypesDefault = Object.freeze([
  "cgroup",
  "cgroup2",
  "configfs",
  "debugfs",
  "devpts",
  "none",
  "overlay",
  "proc",
  "pstore",
  "securityfs",
  "snap*",
  "sysfs",
  "tmpfs",
]) as string[];

/**
 * Default excluded mount point globs for {@link FsOptions}.
 */
export const ExcludedMountPointGlobsDefault = Object.freeze([
  "/dev",
  "/dev/**",
  "/proc/**",
  "/run",
  "/run/lock",
  "/run/qemu",
  "/run/snapd/ns",
  "/snap",
  "/snap/**",
  "/sys/**",
]) as string[];

/**
 * Create an {@link FsOptions} object with default values.
 */
export function options(overrides: Partial<FsOptions> = {}): FsOptions {
  if (!isObject(overrides)) {
    throw new TypeError(
      "options(): expected an object, got " +
        typeof overrides +
        ": " +
        JSON.stringify(overrides),
    );
  }

  return {
    // windows is slower, so give it more time by default.
    timeoutMs: TimeoutMsDefault,
    excludedFileSystemTypes: ExcludedFileSystemTypesDefault,
    excludedMountPointGlobs: ExcludedMountPointGlobsDefault,
    ...overrides,
  };
}
