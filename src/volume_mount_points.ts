// src/mount_point.ts

import { uniqBy } from "./array.js";
import { mapConcurrent, withTimeout } from "./async.js";
import { debug } from "./debuglog.js";
import { getLinuxMountPoints } from "./linux/mount_points.js";
import { compactValues } from "./object.js";
import { isMacOS, isWindows } from "./platform.js";
import {
  isBlank,
  isNotBlank,
  sortObjectsByLocale,
  toNotBlank,
} from "./string.js";
import { assignSystemVolume, SystemVolumeConfig } from "./system_volume.js";
import type { MountPoint } from "./types/mount_point.js";
import type { NativeBindingsFn } from "./types/native_bindings.js";
import type { Options } from "./types/options.js";
import { directoryStatus } from "./volume_health_status.js";

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

export async function getVolumeMountPointsImpl(
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

  const raw = await (isWindows || isMacOS
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

  debug("[getVolumeMountPoints] raw mount points: %o", raw);

  const compacted = raw
    .map((ea) => compactValues(ea) as MountPoint)
    .filter((ea) => isNotBlank(ea.mountPoint));

  for (const ea of compacted) {
    assignSystemVolume(ea, o);
  }

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
    items: results.filter(
      // trust but verify
      (ea) => isBlank(ea.status) || ea.status === "healthy",
    ),
    fn: async (mp) => {
      debug("[getVolumeMountPoints] checking status of %s", mp.mountPoint);
      mp.status = (await directoryStatus(mp.mountPoint, o.timeoutMs)).status;
      debug(
        "[getVolumeMountPoints] status for %s: %s",
        mp.mountPoint,
        mp.status,
      );
    },
  });

  debug(
    "[getVolumeMountPoints] completed with %d mount points",
    results.length,
  );
  return results;
}
