// src/mount_point.ts

import { uniqBy } from "./array";
import { mapConcurrent, validateTimeoutMs, withTimeout } from "./async";
import { debug } from "./debuglog";
import { canReaddir } from "./fs";
import { getLinuxMountPoints } from "./linux/mount_points";
import { compactValues } from "./object";
import { isMacOS, isWindows } from "./platform";
import { isRemoteFsType } from "./remote_info";
import { isBlank, isNotBlank, sortObjectsByLocale, toNotBlank } from "./string";
import { assignSystemVolume, SystemVolumeConfig } from "./system_volume";
import type { MountPoint } from "./types/mount_point";
import type { NativeBindingsFn } from "./types/native_bindings";
import type { Options } from "./types/options";
import { directoryStatus, healthProbeTimeoutMs } from "./volume_health_status";

export type GetVolumeMountPointOptions = Partial<
  Pick<
    Options,
    | "timeoutMs"
    | "linuxMountTablePaths"
    | "maxConcurrency"
    | "includeSystemVolumes"
    | "skipNetworkVolumes"
    | "networkFsTypes"
  > &
    SystemVolumeConfig
>;

type GetVolumeMountPointImplOptions = Required<GetVolumeMountPointOptions> & {
  /**
   * Internal path resolution needs every Linux VFS mount, including file bind
   * mounts. Public volume enumeration omits detected non-directory targets.
   */
  includeNonDirectoryMountPoints?: boolean;
  /**
   * Skip the per-mount-point `readdir()` health probe.
   *
   * The probe exists to report {@link MountPoint.status} and to detect
   * non-directory targets. Internal path resolution
   * ({@link findMountPointByDeviceId}) uses neither: it reads only
   * `mountPoint` and `fstype`, and it already passes
   * `includeNonDirectoryMountPoints`, which disables the only filter the probe
   * feeds. Probing there is pure cost — one unreachable mount would delay
   * *every* path lookup by the probe budget and occupy a libuv worker for it,
   * which is exactly the hazard the ancestor-only `stat()` partitioning exists
   * to avoid.
   *
   * Forwarded to the native enumerator too. Windows honors it by skipping both
   * the drive status check and `GetVolumeInformationW`, the two calls that
   * touch the volume, so a disconnected network drive no longer stalls a lookup
   * on another drive; those entries then carry only `mountPoint`. macOS never
   * reaches this code path — both macOS path APIs resolve through targeted
   * native calls rather than enumeration.
   */
  skipHealthProbes?: boolean;
};

export async function getVolumeMountPointsImpl(
  opts: GetVolumeMountPointImplOptions,
  nativeFn: NativeBindingsFn,
  canReaddirImpl: typeof canReaddir = canReaddir,
): Promise<MountPoint[]> {
  // Validate before starting any work (including native calls) — also on
  // Windows, which relies on native timeouts and bypasses withTimeout().
  validateTimeoutMs(opts.timeoutMs, "getVolumeMountPoints");
  const p = _getVolumeMountPoints(opts, nativeFn, canReaddirImpl);
  return isWindows
    ? p
    : withTimeout({ desc: "getVolumeMountPoints", ...opts, promise: p });
}

async function _getVolumeMountPoints(
  o: GetVolumeMountPointImplOptions,
  nativeFn: NativeBindingsFn,
  canReaddirImpl: typeof canReaddir,
): Promise<MountPoint[]> {
  debug("[getVolumeMountPoints] gathering mount points with options: %o", o);

  const raw = await (isWindows || isMacOS
    ? (async () => {
        debug("[getVolumeMountPoints] using native implementation");
        // macOS owns both its whole-operation deadline and the shorter
        // directory-probe budget. No JS filesystem probes follow it.
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

  // The candidate-only route includes system volumes unconditionally and reads
  // only mountPoint. Avoid manufacturing isSystemVolume on its deliberately
  // minimal Windows records.
  if (!o.skipHealthProbes) {
    for (const ea of compacted) {
      assignSystemVolume(ea, o);
    }
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

  // Each probe gets a fraction of the whole-call budget, never all of it: this
  // call is itself wrapped in withTimeout(o.timeoutMs), so an equal per-probe
  // budget means the enumeration rejects before any single wedged mount point
  // can be marked `timeout` and stepped over.
  //
  // Windows is exempt: getVolumeMountPointsImpl() returns the raw promise there
  // (native code enforces its own timeouts), so there is no outer deadline to
  // lose the race to. Shortening the probe would only make a slow-but-healthy
  // drive that answers within the caller's budget report `timeout` and be
  // skipped by getAllVolumeMetadata().
  const probeTimeoutMs = isWindows
    ? o.timeoutMs
    : healthProbeTimeoutMs(o.timeoutMs);

  const nonDirectoryMountPoints = new Set<string>();
  await mapConcurrent({
    maxConcurrency: o.maxConcurrency,
    items: results.filter(
      (ea) =>
        // skipHealthProbes: callers that read neither status nor the
        // non-directory filter must not pay for — or block on — the probe.
        !isMacOS &&
        !o.skipHealthProbes &&
        // trust but verify
        (isBlank(ea.status) || ea.status === "healthy") &&
        // skipNetworkVolumes: don't health-probe remote volumes — a dead
        // network mount can hang the readdir() probe. Their status is left
        // as reported (undefined on Linux). See Options.skipNetworkVolumes.
        !(o.skipNetworkVolumes && isRemoteFsType(ea.fstype, o.networkFsTypes)),
    ),
    fn: async (mp) => {
      debug("[getVolumeMountPoints] checking status of %s", mp.mountPoint);
      const result = await directoryStatus(
        mp.mountPoint,
        probeTimeoutMs,
        canReaddirImpl,
      );
      mp.status = result.status;
      if (result.isDirectory === false) {
        nonDirectoryMountPoints.add(mp.mountPoint);
      }
      debug(
        "[getVolumeMountPoints] status for %s: %s",
        mp.mountPoint,
        mp.status,
      );
    },
  });

  const visibleResults = o.includeNonDirectoryMountPoints
    ? results
    : results.filter((ea) => !nonDirectoryMountPoints.has(ea.mountPoint));
  debug(
    "[getVolumeMountPoints] completed with %d mount points",
    visibleResults.length,
  );
  return visibleResults;
}
