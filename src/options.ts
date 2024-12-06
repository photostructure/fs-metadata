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
   * Timeout in milliseconds for filesystem operations.
   *
   * Disable timeouts by setting this to 0.
   *
   * @see {@link TimeoutMsDefault}.
   */
  timeoutMs: number;

  /**
   * On Linux and macOS, mount point pathnames that matches any of these glob
   * patterns will have {@link MountPoint.isSystemVolume} set to true.
   *
   * @see {@link SystemPathPatternsDefault} for the default value
   */
  systemPathPatterns: string[];

  /**
   * On Linux and macOS, volumes whose filesystem matches any of these strings
   * will have {@link MountPoint.isSystemVolume} set to true.
   *
   * @see {@link SystemFsTypesDefault} for the default value
   */
  systemFsTypes: Set<string>;

  /**
   * On Linux, use the first mount point table in this array that is readable.
   *
   * @see {@link LinuxMountTablePathsDefault} for the default values
   */
  linuxMountTablePaths: string[];
}

/**
 * Default timeout in milliseconds for {@link Options.timeoutMs}.
 *
 * Note that this timeout may be insufficient for some devices, like spun-down
 * optical drives.
 */
export const TimeoutMsDefault = 7_000 as const;

/**
 * System paths and globs that indicate system volumes
 */
export const SystemPathPatternsDefault = [
  "/boot",
  "/boot/efi",
  "/dev",
  "/dev/**",
  "/proc/**",
  "/run",
  "/run/credentials/**",
  "/run/lock",
  "/run/snapd/**",
  "/run/user/*/doc",
  "/run/user/*/gvfs",
  "/snap/**",
  "/sys/**",

  // MacOS stuff:
  "/private/var/vm", // macOS swap
  "/System/Volumes/Hardware",
  "/System/Volumes/iSCPreboot",
  "/System/Volumes/Preboot",
  "/System/Volumes/Recovery",
  "/System/Volumes/Reserved",
  "/System/Volumes/Update",
  "/System/Volumes/VM",
  "/System/Volumes/xarts",
];

/**
 * Filesystem types that indicate system volumes
 */
export const SystemFsTypesDefault = new Set([
  "autofs",
  "binfmt_misc",
  "cgroup",
  "cgroup2",
  "configfs",
  "debugfs",
  "devpts",
  "devtmpfs",
  "efivarfs",
  "fusectl",
  "hugetlbfs",
  "mqueue",
  "none",
  "proc",
  "pstore",
  "securityfs",
  "snap*",
  "squashfs",
  "sysfs",
  "tmpfs",
]);

export const LinuxMountTablePathsDefault = [
  "/proc/self/mounts",
  "/proc/mounts",
  "/etc/mtab",
];

export const OnlyDirectoriesDefault = true;

/**
 * Default {@link Options} object.
 *
 * @see {@link optionsWithDefaults} for creating an options object with default values
 */
export const OptionsDefault: Options = {
  timeoutMs: TimeoutMsDefault,
  systemPathPatterns: [...SystemPathPatternsDefault],
  systemFsTypes: new Set(SystemFsTypesDefault),
  linuxMountTablePaths: LinuxMountTablePathsDefault,
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
