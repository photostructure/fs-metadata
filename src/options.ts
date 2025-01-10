// src/options.ts

import { availableParallelism } from "node:os";
import { compactValues, isObject } from "./object.js";
import { isWindows } from "./platform.js";
import type { Options } from "./types/options.js";

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
  "/tmp",
  "/var/tmp",
  // we aren't including /tmp/**, as some people temporarily mount volumes there, like /tmp/project.
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
] as const;

/**
 * Filesystem types that indicate system volumes
 */
export const SystemFsTypesDefault = [
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
] as const;

export const LinuxMountTablePathsDefault = [
  "/proc/self/mounts",
  "/proc/mounts",
  "/etc/mtab",
] as const;

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
  systemFsTypes: [...SystemFsTypesDefault],
  linuxMountTablePaths: [...LinuxMountTablePathsDefault],
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
