// src/mount_point.ts

import { uniqBy } from "./array";
import { mapConcurrent, validateTimeoutMs, withTimeout } from "./async";
import { debug } from "./debuglog";
import { getLinuxMountPoints } from "./linux/mount_points";
import { compactValues } from "./object";
import { isMacOS, isWindows } from "./platform";
import { isBlank, isNotBlank, sortObjectsByLocale, toNotBlank } from "./string";
import { assignSystemVolume, SystemVolumeConfig } from "./system_volume";
import type { MountPoint } from "./types/mount_point";
import type { NativeBindingsFn } from "./types/native_bindings";
import type { Options } from "./types/options";
import { directoryStatus } from "./volume_health_status";

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
  // Validate before starting any work (including native calls) — also on
  // Windows, which relies on native timeouts and bypasses withTimeout().
  validateTimeoutMs(opts.timeoutMs, "getVolumeMountPoints");
  const p = _getVolumeMountPoints(opts, nativeFn);
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
    : getLinuxMountPoints(o));

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
