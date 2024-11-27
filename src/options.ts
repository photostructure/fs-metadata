// src/options.ts

import { isObject } from "./object.js";

/**
 * Configuration options for filesystem operations.
 *
 * @see {@link optionsWithDefaults} for creating an options object with default values
 * @see {@link OptionsDefault} for the default values
 */
export interface Options {
  /**
   * Timeout in milliseconds for filesystem operations. Disable timeouts by
   * setting this to 0.
   *
   * Default is 5000ms (5 seconds) on macOS and Linux, and 15000ms (15 seconds)
   * on Windows.
   *
   * @see {@link TimeoutMsDefault} for the default value
   */
  timeoutMs: number;

  /**
   * File system types to exclude when listing mount points. Only applied on
   * Linux and macOS systems.
   *
   * @see {@link ExcludedFileSystemTypesDefault} for the default values
   */
  excludedFileSystemTypes: string[];

  /**
   * Glob patterns to exclude when listing mount points.
   *
   * POSIX forward-slashed pathnames will work on all platforms.
   *
   * @see {@link ExcludedMountPointGlobsDefault} for the default values
   */
  excludedMountPointGlobs: string[];

  /**
   * On Linux, use the first mount point table in this array that is readable.
   *
   * @see {@link LinuxMountTablePathsDefault} for the default values
   */
  linuxMountTablePaths: string[];

  /**
   * Should only readable directories be included?
   *
   * @default true
   */
  onlyDirectories: boolean;
}

/**
 * Default timeout in milliseconds for {@link Options}.
 *
 * Note that this timeout may be insufficient for some devices, like spun-down
 * optical drives.
 */
export const TimeoutMsDefault = 7_000;

/**
 * Default excluded file system types for {@link Options}.
 *
 * Note that these are only applied on Linux and macOS systems.
 */
export const ExcludedFileSystemTypesDefault = [
  "cgroup",
  "cgroup2",
  "configfs",
  "debugfs",
  "devpts",
  "none",
  "proc",
  "pstore",
  "securityfs",
  "snap*",
  "sysfs",
  "tmpfs",
] as const;

/**
 * Default excluded mount point globs for {@link Options}.
 */
export const ExcludedMountPointGlobsDefault = [
  "/boot",
  "/boot/efi",
  "/dev",
  "/dev/**",
  "/private/var/vm", // macOS swap
  "/proc/**",
  "/run",
  "/run/credentials/**",
  "/run/lock",
  "/run/snapd/**",
  "/run/user/*/doc",
  "/run/user/*/gvfs",
  "/snap/**",
  "/sys/**",

  // APFS stuff:
  "/System/Volumes/Hardware",
  "/System/Volumes/iSCPreboot",
  "/System/Volumes/Preboot",
  "/System/Volumes/Recovery",
  "/System/Volumes/Reserved",
  "/System/Volumes/Update",
  "/System/Volumes/VM",
  "/System/Volumes/xarts",
] as const;

export const OnlyDirectoriesDefault = true;

export const LinuxMountTablePathsDefault = [
  "/proc/self/mounts",
  "/proc/mounts",
  "/etc/mtab",
];

/**
 * Default {@link Options} object.
 *
 * @see {@link optionsWithDefaults} for creating an options object with default values
 */
export const OptionsDefault: Options = {
  timeoutMs: TimeoutMsDefault,
  excludedFileSystemTypes: [...ExcludedFileSystemTypesDefault],
  excludedMountPointGlobs: [...ExcludedMountPointGlobsDefault],
  linuxMountTablePaths: LinuxMountTablePathsDefault,
  onlyDirectories: OnlyDirectoriesDefault,
} as const;

/**
 * Create an {@link Options} object using default values from
 * {@link OptionsDefault} for missing fields.
 */
export function optionsWithDefaults(overrides: Partial<Options> = {}): Options {
  if (!isObject(overrides)) {
    throw new TypeError(
      "options(): expected an object, got " +
        typeof overrides +
        ": " +
        JSON.stringify(overrides),
    );
  }

  return {
    ...OptionsDefault,
    ...overrides,
  };
}
