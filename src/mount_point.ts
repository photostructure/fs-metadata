// src/mount_point.ts

import { uniqBy } from "./array.js";
import { withTimeout } from "./async.js";
import { compileGlob } from "./glob.js";
import { getLinuxMountPoints } from "./linux/mount_points.js";
import { NativeBindingsFn } from "./native_bindings.js";
import { compactValues, isObject } from "./object.js";
import {
  Options,
  SystemFsTypesDefault,
  SystemPathPatternsDefault,
} from "./options.js";
import { isMacOS, isWindows } from "./platform.js";
import { isNotBlank, sortObjectsByLocale } from "./string.js";
import { VolumeHealthStatus } from "./volume_health_status.js";

/**
 * A mount point is a location in the file system where a volume is mounted.
 */
export interface MountPoint {
  /**
   * Mount location (like "/" or "C:\").
   */
  mountPoint: string;

  /**
   * The type of file system on the volume, like `ext4`, `apfs`, or `ntfs`.
   *
   * Note: on Windows this may show as "ntfs" for remote filesystems, as that
   * is how the filesystem is presented to the OS.
   */
  fstype?: string;

  /**
   * On Windows, returns the health status of the volume.
   *
   * Note that this is only available on Windows, as both Linux and macOS  are
   * prohibitively expensive, requiring forking `fsck -N` or `diskutil
   * verifyVolume`.
   *
   * If there are non-critical errors while extracting metadata, those error
   * messages may be added to this field (say, from blkid or gio).
   *
   * @see {@link VolumeHealthStatuses} for values returned by Windows.
   */
  status?: VolumeHealthStatus | string;

  /**
   * Indicates if this volume is primarily for system use (e.g., swap, snap
   * loopbacks, EFI boot, or only system directories).
   *
   * Note: This is a best-effort classification and is not 100% accurate.
   *
   * @see {@link Options.systemPathPatterns} and {@link Options.systemFsTypes}
   */
  isSystemVolume?: boolean;
}

export function isMountPoint(obj: unknown): obj is MountPoint {
  if (!isObject(obj)) return false;
  return "mountPoint" in obj && isNotBlank(obj.mountPoint);
}

export function toMountPoint(
  mp: MountPoint | undefined,
  options: Partial<SystemVolumeConfig> = {},
): MountPoint | undefined {
  return isMountPoint(mp)
    ? (compactValues({
        isSystemVolume: isSystemVolume(mp.mountPoint, mp.fstype, options),
        ...compactValues(mp),
      }) as MountPoint)
    : undefined;
}

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
  return (
    (isNotBlank(fstype) &&
      (config.systemFsTypes ?? SystemFsTypesDefault).has(fstype)) ||
    compileGlob(config.systemPathPatterns ?? SystemPathPatternsDefault).test(
      mountPoint,
    )
  );
}

export type GetVolumeMountPointOptions = Partial<
  Pick<Options, "timeoutMs" | "linuxMountTablePaths"> & SystemVolumeConfig
>;

/**
 * Helper function for {@link ExportsImpl.getVolumeMountPoints}.
 */
export async function getVolumeMountPoints(
  opts: Required<GetVolumeMountPointOptions>,
  nativeFn: NativeBindingsFn,
): Promise<MountPoint[]> {
  const p = _getVolumeMountPoints(opts, nativeFn);
  // we rely on the native bindings on Windows to do proper timeouts
  return isWindows
    ? p
    : withTimeout({ desc: "getVolumeMountPoints", ...opts, promise: p });
}

async function _getVolumeMountPoints(
  o: Required<GetVolumeMountPointOptions>,
  nativeFn: NativeBindingsFn,
): Promise<MountPoint[]> {
  const arr = await (isWindows || isMacOS
    ? (await nativeFn()).getVolumeMountPoints(o)
    : getLinuxMountPoints(nativeFn, o));
  const result = arr
    .map((ea) => toMountPoint(ea, o))
    .filter((ea) => ea != null);
  const uniq = uniqBy(result, (ea) => ea.mountPoint);
  return sortObjectsByLocale(uniq, (ea) => ea.mountPoint);
}
