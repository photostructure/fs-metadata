// src/mount_point.ts

import { uniqBy } from "./array.js";
import { mapConcurrent, withTimeout } from "./async.js";
import { debug } from "./debuglog.js";
import { getLinuxMountPoints } from "./linux/mount_points.js";
import { compactValues, isObject } from "./object.js";
import { Options } from "./options.js";
import { isMacOS, isWindows } from "./platform.js";
import { isNotBlank, sortObjectsByLocale, toNotBlank } from "./string.js";
import { assignSystemVolume, SystemVolumeConfig } from "./system_volume.js";
import type { NativeBindingsFn } from "./types/native_bindings.js";
import { directoryStatus, VolumeHealthStatus } from "./volume_health_status.js";

/**
 * A mount point is a location in the file system where a volume is mounted.
 *
 * @see https://en.wikipedia.org/wiki/Mount_(computing)
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

  /**
   * If there are non-critical errors while extracting metadata, those errors
   * may be added to this field.
   */
  error?: Error | string;
}

export function isMountPoint(obj: unknown): obj is MountPoint {
  if (!isObject(obj)) return false;
  return "mountPoint" in obj && isNotBlank(obj.mountPoint);
}

export type GetVolumeMountPointOptions = Partial<
  Pick<
    Options,
    | "timeoutMs"
    | "linuxMountTablePaths"
    | "maxConcurrency"
    | "includeSystemVolumes"
  > &
    SystemVolumeConfig
>;

/**
 * Helper function for {@link getVolumeMountPoints}.
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
  debug("[getVolumeMountPoints] gathering mount points with options: %o", o);

  const result = await (isWindows || isMacOS
    ? (async () => {
        debug("[getVolumeMountPoints] using native implementation");
        const points = await (await nativeFn()).getVolumeMountPoints(o);
        debug(
          "[getVolumeMountPoints] native returned %d mount points",
          points.length,
        );
        return points;
      })()
    : getLinuxMountPoints(nativeFn, o));

  debug("[getVolumeMountPoints] raw mount points: %o", result);
  const compacted = result
    .map((ea) => compactValues(ea) as MountPoint)
    .filter((ea) => isNotBlank(ea.mountPoint));
  const filtered = o.includeSystemVolumes
    ? compacted
    : compacted.filter((ea) => !ea.isSystemVolume);
  const uniq = uniqBy(filtered, (ea) => toNotBlank(ea.mountPoint));
  debug("[getVolumeMountPoints] found %d unique mount points", uniq.length);
  const results = sortObjectsByLocale(uniq, (ea) => ea.mountPoint);
  debug(
    "[getVolumeMountPoints] getting status for %d mount points",
    results.length,
  );

  await mapConcurrent({
    maxConcurrency: o.maxConcurrency,
    items: results,
    fn: async (mp) => {
      assignSystemVolume(mp, o);

      if ((toNotBlank(mp.status) ?? "healthy") === "healthy") {
        // trust but verify
        debug("[getVolumeMountPoints] checking status of %s", mp.mountPoint);
        mp.status = (await directoryStatus(mp.mountPoint, o.timeoutMs)).status;
        debug(
          "[getVolumeMountPoints] status for %s: %s",
          mp.mountPoint,
          mp.status,
        );
      }
    },
  });

  debug(
    "[getVolumeMountPoints] completed with %d mount points",
    results.length,
  );
  return results;
}
