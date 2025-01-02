// src/options.ts

import { availableParallelism } from "node:os";
import { compactValues, isObject } from "./object.js";
import { isWindows } from "./platform.js";

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
   * Maximum number of concurrent filesystem operations.
   *
   * Defaults to {@link https://nodejs.org/api/os.html#osavailableparallelism | availableParallelism}.
   */
  maxConcurrency: number;

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

  /**
   * Should system volumes be included in result arrays? Defaults to true on
   * Windows and false elsewhere.
   */
  includeSystemVolumes: boolean;
}

/**
 * Default timeout in milliseconds for {@link Options.timeoutMs}.
 *
 * Note that this timeout may be insufficient for some devices, like spun-down
 * optical drives or network shares that need to spin up or reconnect.
 */
export const TimeoutMsDefault = 5_000 as const;

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
  "**/#snapshot", // Synology and Kubernetes volume snapshots

  // windows for linux:
  "/mnt/wslg/distro",
  "/mnt/wslg/doc",
  "/mnt/wslg/versions.txt",
  "/usr/lib/wsl/drivers",

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
  "fuse.snapfuse",
  "hugetlbfs",
  "mqueue",
  "none",
  "proc",
  "pstore",
  "rootfs",
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

/**
 * Should {@link getAllVolumeMetadata} include system volumes by
 * default?
 */
export const IncludeSystemVolumesDefault = isWindows;

/**
 * Default {@link Options} object.
 *
 * @see {@link optionsWithDefaults} for creating an options object with default values
 */
export const OptionsDefault: Options = {
  timeoutMs: TimeoutMsDefault,
  maxConcurrency: availableParallelism(),
  systemPathPatterns: [...SystemPathPatternsDefault],
  systemFsTypes: new Set(SystemFsTypesDefault),
  linuxMountTablePaths: LinuxMountTablePathsDefault,
  includeSystemVolumes: IncludeSystemVolumesDefault,
} as const;

/**
 * Create an {@link Options} object using default values from
 * {@link OptionsDefault} for missing fields.
 */
export function optionsWithDefaults<T extends Options>(
  overrides: Partial<T> = {},
): T {
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
    ...(compactValues(overrides) as T),
  };
}
