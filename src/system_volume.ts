// src/system_volume.ts

import { debug } from "./debuglog.js";
import { compileGlob } from "./glob.js";
import { MountPoint } from "./mount_point.js";
import {
  Options,
  SystemFsTypesDefault,
  SystemPathPatternsDefault,
} from "./options.js";
import { normalizePath } from "./path.js";
import { isWindows } from "./platform.js";
import { isNotBlank } from "./string.js";

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
  debug("[isSystemVolume] checking %s (fstype: %s)", mountPoint, fstype);
  if (isWindows) {
    const systemDrive = normalizePath(process.env["SystemDrive"]);
    if (systemDrive != null && mountPoint === systemDrive) {
      debug("[isSystemVolume] %s is the Windows system drive", mountPoint);
      return true;
    }
  }
  const result =
    (isNotBlank(fstype) &&
      (config.systemFsTypes ?? SystemFsTypesDefault).has(fstype)) ||
    compileGlob(config.systemPathPatterns ?? SystemPathPatternsDefault).test(
      mountPoint,
    );
  debug("[isSystemVolume] %s -> %s", mountPoint, result);
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
