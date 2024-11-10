// src/Config.ts

import { deepFreeze, DeepReadonly } from "./DeepFreeze";

export interface Config {
  excludedFileSystemTypes: string[];
  excludedMountPointGlobs: string[];
}

export const DefaultConfig: DeepReadonly<Config> = deepFreeze({
  excludedFileSystemTypes: [
    "proc",
    "sysfs",
    "devpts",
    "tmpfs",
    "cgroup",
    "cgroup2",
    "pstore",
    "securityfs",
    "debugfs",
    "configfs",
  ],
  excludedMountPointGlobs: [
    "/proc/**",
    "/snap/**",
    "/sys/**",
    "/dev/**",
    "/dev",
    "/run",
    "/run/lock",
    "/run/qemu",
    "/run/snapd/ns",
  ],
});

let config: DeepReadonly<Config> = DefaultConfig;

export function setConfig(cfg: Partial<Config>) {
  config = deepFreeze({ ...DefaultConfig, ...cfg });
}

export function getConfig(): DeepReadonly<Config> {
  return config;
}
