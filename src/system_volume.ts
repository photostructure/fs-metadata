// src/system_volume.ts

import { debug } from "./debuglog";
import { compileGlob } from "./glob";
import { SystemFsTypesDefault, SystemPathPatternsDefault } from "./options";
import { normalizePath } from "./path";
import { isWindows } from "./platform";
import { isNotBlank } from "./string";
import type { MountPoint } from "./types/mount_point";
import type { Options } from "./types/options";

/**
 * Configuration for system volume detection
 *
 * @see {@link MountPoint.isSystemVolume}
 */
export type SystemVolumeConfig = Pick<
  Options,
  "systemPathPatterns" | "systemFsTypes"
>;

/**
 * Determines if a mount point represents a system volume based on its path and
 * filesystem type
 */
export function isSystemVolume(
  mountPoint: string,
  fstype: string | undefined,
  config: Partial<SystemVolumeConfig> = {},
): boolean {
  if (isWindows) {
    const systemDrive = normalizePath(process.env["SystemDrive"]);
    if (systemDrive != null && mountPoint === systemDrive) {
      debug("[isSystemVolume] %s is the Windows system drive", mountPoint);
      return true;
    }
  }
  const isSystemFsType =
    isNotBlank(fstype) &&
    ((config.systemFsTypes ?? SystemFsTypesDefault) as string[]).includes(
      fstype,
    );
  const hasSystemPath = compileGlob(
    config.systemPathPatterns ?? SystemPathPatternsDefault,
  ).test(mountPoint);
  const result = isSystemFsType || hasSystemPath;
  debug("[isSystemVolume]", {
    mountPoint,
    fstype,
    result,
    isSystemFsType,
    hasSystemPath,
  });
  return result;
}

export function assignSystemVolume(
  mp: MountPoint,
  config: Partial<SystemVolumeConfig>,
) {
  const result = isSystemVolume(mp.mountPoint, mp.fstype, config);

  // Native code may have already marked this as a system volume (e.g.,
  // Windows system drive detection, macOS MNT_SNAPSHOT for the sealed
  // APFS system snapshot at /). Never downgrade a native true — only
  // upgrade via path/fstype heuristics.
  mp.isSystemVolume = mp.isSystemVolume || result;
}
