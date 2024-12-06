// src/mount_point.ts

import { uniqBy } from "./array.js";
import { compileGlob } from "./glob.js";
import { getLinuxMountPoints } from "./linux/mount_points.js";
import { NativeBindingsFn } from "./native_bindings.js";
import { compactValues, isObject } from "./object.js";
import {
  Options,
  optionsWithDefaults,
  SystemFsTypesDefault,
  SystemPathPatternsDefault,
} from "./options.js";
import { isMacOS, isWindows } from "./platform.js";
import { isNotBlank, sortObjectsByLocale } from "./string.js";

/** Volume is "OK": accessible and functioning normally */
export const Healthy = "healthy" as const;

/** Volume exists but can't be accessed (permissions/locks) */
export const Inaccessible = "inaccessible" as const;

/** Network volume that's offline */
export const Disconnected = "disconnected" as const;

/** Volume has errors or performance issues */
export const Degraded = "degraded" as const;

/** Status can't be determined */
export const Unknown = "unknown" as const;

export type VolumeHealthStatus =
  | typeof Healthy
  | typeof Inaccessible
  | typeof Disconnected
  | typeof Degraded
  | typeof Unknown;

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
  fstype: string;

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
   * @see {@link VolumeHealthStatus} for all possible values.
   */
  status?: VolumeHealthStatus;

  /**
   * Indicates if this volume is primarily for system use (e.g., swap, snap
   * loopbacks, EFI boot, system directories).
   *
   * Note: This is a best-effort classification and is not 100% accurate.
   *
   * @see {@link Options.systemPathPatterns} and {@link Options.systemFsTypes}
   */
  isSystemVolume?: boolean;
}

export function isMountPoint(obj: unknown): obj is MountPoint {
  if (!isObject(obj)) return false;
  const { mountPoint, fstype } = obj as Partial<MountPoint>;
  return isNotBlank(mountPoint) && isNotBlank(fstype);
}

export function toMountPoint(
  mp: MountPoint | undefined,
  options: Partial<SystemVolumeConfig> = {},
): MountPoint | undefined {
  return isMountPoint(mp)
    ? ({
        isSystemVolume: isSystemVolume(mp.mountPoint, mp.fstype, options),
        ...compactValues(mp),
      } as MountPoint)
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
  fstype: string,
  config: Partial<SystemVolumeConfig> = {},
): boolean {
  return (
    (config.systemFsTypes ?? SystemFsTypesDefault).has(fstype) ||
    compileGlob(config.systemPathPatterns ?? SystemPathPatternsDefault).test(
      mountPoint,
    )
  );
}

export type GetVolumeMountPointOptions = Pick<Options, "timeoutMs"> &
  Partial<SystemVolumeConfig>;

/**
 * Helper function for {@link ExportsImpl.getVolumeMountPoints}.
 */
export async function getVolumeMountPoints(
  nativeFn: NativeBindingsFn,
  opts: GetVolumeMountPointOptions,
): Promise<MountPoint[]> {
  const o = optionsWithDefaults(opts);
  const arr = await (isWindows || isMacOS
    ? (await nativeFn()).getVolumeMountPoints()
    : getLinuxMountPoints(nativeFn, o));
  const result = arr
    .map((ea) => toMountPoint(ea, o))
    .filter((ea) => ea != null);
  const uniq = uniqBy(result, (ea) => ea.mountPoint);
  return sortObjectsByLocale(uniq, (ea) => ea.mountPoint);
}
