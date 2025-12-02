// src/options.ts

import { availableParallelism } from "node:os";
import { env } from "node:process";
import { compactValues, isObject } from "./object";
import { isWindows } from "./platform";
import type { Options } from "./types/options";

const DefaultTimeoutMs = 5_000;

/**
 * Get the default timeout in milliseconds for {@link Options.timeoutMs}.
 *
 * This can be overridden by setting the `FS_METADATA_TIMEOUT_MS` environment
 * variable to a positive integer.
 *
 * Note that this timeout may be insufficient for some devices, like spun-down
 * optical drives or network shares that need to spin up or reconnect.
 *
 * @returns The timeout from env var if valid, otherwise 5000ms
 */
export function getTimeoutMsDefault(): number {
  const value = env["FS_METADATA_TIMEOUT_MS"];
  if (value == null) return DefaultTimeoutMs;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DefaultTimeoutMs;
}

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
 * Default value for {@link Options.skipNetworkVolumes}.
 */
export const SkipNetworkVolumesDefault = false;

/**
 * Default {@link Options} object.
 *
 * @see {@link optionsWithDefaults} for creating an options object with default values
 */
export const OptionsDefault: Options = {
  timeoutMs: getTimeoutMsDefault(),
  maxConcurrency: availableParallelism(),
  systemPathPatterns: [...SystemPathPatternsDefault],
  systemFsTypes: [...SystemFsTypesDefault],
  linuxMountTablePaths: [...LinuxMountTablePathsDefault],
  includeSystemVolumes: IncludeSystemVolumesDefault,
  skipNetworkVolumes: SkipNetworkVolumesDefault,
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
