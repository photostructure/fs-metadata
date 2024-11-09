// Config.ts

import { deepFreeze, DeepReadonly } from "./DeepFreeze";

export interface Config {
  excludedFilesystemTypes: string[];
  excludedMountpointGlobs: string[];
}

export const DefaultConfig: DeepReadonly<Config> = deepFreeze({
  excludedFilesystemTypes: [
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
  excludedMountpointGlobs: [
    "/proc/**",
    "/snap/**",
    "/sys/**",
    "/dev/**",
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
