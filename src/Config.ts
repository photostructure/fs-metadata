// src/Config.ts

import { deepFreeze, DeepReadonly } from "./DeepFreeze.js";

/**
 * Configuration for {@link getVolumeMountPoints}.
 */
export interface Config {
  /**
   * File system types to exclude from {@link getVolumeMountPoints}.
   *
   * **Only applied on Linux and macOS systems.**
   *
   * There's no dire need to post-filter Windows mountpoints, as they are just
   * drive letters--there's no nonsense like `/snap/*`, and to fetch fstype on
   * Windows would require another syscall per mountpoint.
   */
  excludedFileSystemTypes: string[];

  /**
   * Glob patterns to exclude from {@link getVolumeMountPoints}.
   */
  excludedMountPointGlobs: string[];
}

/**
 * A set of default paths and globs to exclude from
 * {@link getVolumeMountPoints}. You may want to use this as a base for your own
 * configuration.
 */
export const DefaultConfig: DeepReadonly<Config> = deepFreeze({
  excludedFileSystemTypes: [
    "cgroup",
    "cgroup2",
    "configfs",
    "debugfs",
    "devpts",
    "proc",
    "pstore",
    "securityfs",
    "sysfs",
    "tmpfs",
  ],
  excludedMountPointGlobs: [
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
  ],
});

/**
 * An empty configuration. This disables all filters applied to
 * {@link getVolumeMountPoints}.
 */
export const EmptyConfig: DeepReadonly<Config> = deepFreeze({
  excludedFileSystemTypes: [],
  excludedMountPointGlobs: [],
});

let config: DeepReadonly<Config> = DefaultConfig;

export function setConfig(cfg: Partial<Config>) {
  config = deepFreeze({ ...DefaultConfig, ...cfg });
}

export function getConfig(): DeepReadonly<Config> {
  return config;
}
