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

  if (isWindows) {
    // native code actually knows the system drive and has more in-depth
    // metadata information that we trust more than these heuristics
    mp.isSystemVolume ??= result;
  } else {
    // macOS and Linux don't have a concept of an explicit "system drive" like
    // Windows--always trust our heuristics
    mp.isSystemVolume = result;
  }
}
