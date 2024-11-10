// src/Config.ts

import { deepFreeze, DeepReadonly } from "./DeepFreeze";

export interface Config {
  excludedFileSystemTypes: string[];
  excludedMountPointGlobs: string[];
}

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

let config: DeepReadonly<Config> = DefaultConfig;

export function setConfig(cfg: Partial<Config>) {
  config = deepFreeze({ ...DefaultConfig, ...cfg });
}

export function getConfig(): DeepReadonly<Config> {
  return config;
}
