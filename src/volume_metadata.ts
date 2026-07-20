// src/volume_metadata.ts

import type { Stats } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { mapConcurrent, validateTimeoutMs, withTimeout } from "./async";
import { debug } from "./debuglog";
import { WrappedError } from "./error";
import { statAsync } from "./fs";
import { getLabelFromDevDisk, getUuidFromDevDisk } from "./linux/dev_disk";
import { getLinuxMtabMetadata } from "./linux/mount_points";
import {
  type MtabVolumeMetadata,
  mountEntryToPartialVolumeMetadata,
} from "./linux/mtab";
import { compactValues } from "./object";
import { IncludeSystemVolumesDefault, optionsWithDefaults } from "./options";
import { isAncestorOrSelf, normalizePath } from "./path";
import { isLinux, isMacOS, isWindows } from "./platform";
import { extractRemoteInfo, isRemoteFsType } from "./remote_info";
import { isBlank, isNotBlank } from "./string";
import { assignSystemVolume } from "./system_volume";
import type {
  GetVolumeMetadataOptions,
  NativeBindingsFn,
} from "./types/native_bindings";
import type { Options } from "./types/options";
import type { VolumeMetadata } from "./types/volume_metadata";
import { parseUNCPath } from "./unc";
import { extractUUID } from "./uuid";
import { VolumeHealthStatuses, directoryStatus } from "./volume_health_status";
import { getVolumeMountPointsImpl } from "./volume_mount_points";

export async function getVolumeMetadataImpl(
  o: GetVolumeMetadataOptions & Options,
  nativeFn: NativeBindingsFn,
): Promise<VolumeMetadata> {
  if (isBlank(o.mountPoint)) {
    throw new TypeError(
      "Invalid mountPoint: got " + JSON.stringify(o.mountPoint),
    );
  }

  // Validate before starting any work (including native calls) — also on
  // Windows, where the native health probe also receives this timeout.
  validateTimeoutMs(o.timeoutMs, "getVolumeMetadata()");
  const p = _getVolumeMetadata(o, nativeFn);
  return withTimeout({
    desc: "getVolumeMetadata()",
    timeoutMs: o.timeoutMs,
    promise: p,
  });
}

async function _getVolumeMetadata(
  o: GetVolumeMetadataOptions & Options,
  nativeFn: NativeBindingsFn,
): Promise<VolumeMetadata> {
  o = optionsWithDefaults(o);
  const norm = normalizePath(o.mountPoint);
  if (norm == null) {
    throw new Error("Invalid mountPoint: " + JSON.stringify(o.mountPoint));
  }
  o.mountPoint = norm;

  debug(
    "[getVolumeMetadata] starting metadata collection for %s",
    o.mountPoint,
  );
  debug("[getVolumeMetadata] options: %o", o);

  let remote: boolean = false;
  let mtabInfo: undefined | MtabVolumeMetadata;
  let device: undefined | string;
  // On Linux, read the mount table before touching the mount point: it comes
  // from /proc (or /etc/mtab) and never blocks on the volume itself, so
  // remote-ness is known before any IO that could hang on a dead mount.
  if (isLinux) {
    debug("[getVolumeMetadata] collecting Linux mtab info");
    try {
      const m = await getLinuxMtabMetadata(o.mountPoint, o);
      mtabInfo = mountEntryToPartialVolumeMetadata(m, o);
      debug("[getVolumeMetadata] mtab info: %o", mtabInfo);
      if (mtabInfo.remote) {
        remote = true;
      }
      if (isNotBlank(m.fs_spec)) {
        device = m.fs_spec;
      }
    } catch (err) {
      debug("[getVolumeMetadata] failed to get mtab info: " + err);
      // Mtab lookup can fail for transient mounts or race conditions.
      // Ignore and continue with whatever the native call returns.
    }
  }

  if (o.skipNetworkVolumes && remote) {
    // Honor skipNetworkVolumes without probing the mount point: both
    // directoryStatus() and the native worker (open()/fstatvfs()) would
    // block on an unreachable network volume. status is "unknown" because
    // we deliberately didn't check.
    debug(
      "[getVolumeMetadata] skipping detailed queries for network volume %s",
      o.mountPoint,
    );
    return compactValues({
      ...compactValues(mtabInfo),
      mountPoint: o.mountPoint,
      status: VolumeHealthStatuses.unknown,
      remote: true,
    }) as VolumeMetadata;
  }

  const pathStatus = await directoryStatus(o.mountPoint, o.timeoutMs);
  const isNonDirectoryLinuxMount =
    isLinux && pathStatus.isDirectory === false && mtabInfo != null;
  if (
    pathStatus.status !== VolumeHealthStatuses.healthy &&
    !isNonDirectoryLinuxMount
  ) {
    const { error, status } = pathStatus;
    debug("[getVolumeMetadata] directoryStatus error: %s", error);
    throw error ?? new Error("Volume not healthy: " + status);
  }

  const status = isNonDirectoryLinuxMount
    ? VolumeHealthStatuses.healthy
    : pathStatus.status;

  debug("[getVolumeMetadata] path status: %s", status);

  if (isNotBlank(device)) {
    o.device = device;
    debug("[getVolumeMetadata] using device: %s", device);
  }

  // Pass the mtab fstype to native so the Linux worker can gate btrfs-only
  // probes (the subvolume-UUID ioctl) without attempting them on other
  // filesystems.
  if (isNotBlank(mtabInfo?.fstype)) {
    o.fstype = mtabInfo.fstype;
  }

  debug("[getVolumeMetadata] requesting native metadata");
  const metadata = (await (
    await nativeFn()
  ).getVolumeMetadata(o)) as VolumeMetadata;
  debug("[getVolumeMetadata] native metadata: %o", metadata);

  // Some OS implementations leave it up to us to extract remote info:
  const remoteInfo =
    mtabInfo ??
    extractRemoteInfo(metadata.uri, o.networkFsTypes) ??
    extractRemoteInfo(metadata.mountFrom, o.networkFsTypes) ??
    (isWindows ? parseUNCPath(o.mountPoint) : undefined);

  debug("[getVolumeMetadata] extracted remote info: %o", remoteInfo);

  remote ||=
    isRemoteFsType(metadata.fstype, o.networkFsTypes) ||
    (remoteInfo?.remote ?? metadata.remote ?? false);

  debug("[getVolumeMetadata] assembling: %o", {
    status,
    mtabInfo,
    remoteInfo,
    metadata,
    mountPoint: o.mountPoint,
    remote,
  });
  const result = compactValues({
    status, // < let the implementation's status win by having this first
    ...compactValues(remoteInfo),
    ...compactValues(metadata),
    ...compactValues(mtabInfo),
    mountPoint: o.mountPoint,
    remote,
  }) as VolumeMetadata;

  // Backfill if blkid failed us:
  if (isLinux && isNotBlank(device)) {
    // Sometimes blkid doesn't have the UUID in cache. Try to get it from
    // /dev/disk/by-uuid:
    result.uuid ??= (await getUuidFromDevDisk(device)) ?? "";
    result.label ??= (await getLabelFromDevDisk(device)) ?? "";
  }

  assignSystemVolume(result, o);

  // Fix microsoft's UUID format:
  result.uuid = extractUUID(result.uuid) ?? result.uuid ?? "";

  debug("[getVolumeMetadata] final result for %s: %o", o.mountPoint, result);
  return compactValues(result) as VolumeMetadata;
}

/**
 * Get volume metadata for an arbitrary file or directory path.
 *
 * Unlike {@link getVolumeMetadataImpl}, this accepts any path — not just mount
 * points. It resolves symlinks and correctly handles macOS APFS firmlinks
 * (e.g. `/Users` → `/System/Volumes/Data`), mirroring what `df` does.
 *
 * On macOS, the native `fstatfs()` call returns `f_mntonname` (the canonical
 * mount point), exposed here as `mountName`. This is used to resolve firmlinks
 * without `stat().dev`, which does NOT follow firmlinks.
 *
 * On Linux and Windows, `stat().dev` device IDs are reliable (no firmlinks),
 * so mount point discovery uses device ID + path prefix matching.
 */
export async function getVolumeMetadataForPathImpl(
  pathname: string,
  opts: Options,
  nativeFn: NativeBindingsFn,
  resolvePath: typeof realpath = realpath,
): Promise<VolumeMetadata> {
  if (isBlank(pathname)) {
    throw new TypeError("Invalid pathname: got " + JSON.stringify(pathname));
  }

  // Validate before any path work: with a caller-supplied opts.mountPoints
  // this route can otherwise finish (or fail for unrelated reasons) without
  // ever reaching a timeoutMs check.
  validateTimeoutMs(opts.timeoutMs, "getVolumeMetadataForPath()");

  // This deadline wraps the WHOLE operation, including realpath()/stat() and the
  // nested getVolumeMetadataImpl() call inside _getVolumeMetadataForPath().
  // getVolumeMetadataImpl() has its own withTimeout(), but that inner one only
  // starts after path resolution, so this outer wrapper is what bounds a hung
  // realpath(). The two are intentional — don't drop this as "redundant".
  return withTimeout({
    desc: "getVolumeMetadataForPath()",
    timeoutMs: opts.timeoutMs,
    promise: _getVolumeMetadataForPath(pathname, opts, nativeFn, resolvePath),
  });
}

async function _getVolumeMetadataForPath(
  pathname: string,
  opts: Options,
  nativeFn: NativeBindingsFn,
  resolvePath: typeof realpath,
): Promise<VolumeMetadata> {
  // realpath() resolves POSIX symlinks. APFS firmlinks are NOT resolved by
  // realpath(), but fstatfs() follows them — handled below.
  const resolved = await resolvePath(pathname);

  // macOS probes the containing directory. Linux/Windows use the original
  // path below so an exact Linux file bind mount remains distinguishable.
  const resolvedStat = await statAsync(resolved);
  const dir = resolvedStat.isDirectory() ? resolved : dirname(resolved);

  if (isMacOS) {
    // On macOS, native fstatfs() sets mountName = f_mntonname, which is the
    // canonical mount point even through APFS firmlinks. Probe the dir to get
    // it, then re-query with the canonical mount point so the result has
    // mountPoint set correctly.
    const probe = await getVolumeMetadataImpl(
      { ...opts, mountPoint: dir },
      nativeFn,
    );
    const canonicalMountPoint = isNotBlank(probe.mountName)
      ? probe.mountName
      : dir;
    if (canonicalMountPoint === dir) return probe;
    return getVolumeMetadataImpl(
      { ...opts, mountPoint: canonicalMountPoint },
      nativeFn,
    );
  }

  // Linux/Windows: stat().dev is reliable (no firmlinks). Find the mount point
  // by comparing device IDs, using path prefix as a tiebreaker for bind mounts
  // or GVfs/FUSE mounts that share the same device id.
  const mountPoint = await findMountPointByDeviceId(
    resolved,
    resolvedStat,
    opts,
    nativeFn,
  );

  return getVolumeMetadataImpl({ ...opts, mountPoint }, nativeFn);
}

/**
 * Find the mount point for a resolved path using device ID + path ancestry.
 * Used on Linux and Windows where stat().dev is reliable (no firmlinks).
 *
 * Device ID filters out unrelated filesystems. Among same-device mount points,
 * ancestor-path matches (mount point is a parent of `resolved`) are strongly
 * preferred over device-only matches — GVfs/FUSE mounts on Linux can share
 * the same device ID across unrelated volumes (e.g. multiple SMB shares
 * under /run/user/.../gvfs/), so device ID alone is ambiguous. The longest
 * ancestor wins.
 *
 * The device-only fallback (`deviceMatches`) exists for bind mounts where the
 * canonical mount point may not be a path ancestor of the target.
 */
export async function findMountPointByDeviceId(
  resolved: string,
  resolvedStat: Stats,
  opts: Options,
  nativeFn: NativeBindingsFn,
): Promise<string> {
  const targetDev = resolvedStat.dev;
  const mountPoints =
    opts.mountPoints ??
    (await getVolumeMountPointsImpl(
      {
        ...opts,
        includeSystemVolumes: true,
        includeNonDirectoryMountPoints: true,
      },
      nativeFn,
    ));

  const prefixMatches: string[] = [];
  const deviceMatches: string[] = [];

  await Promise.all(
    mountPoints.map(async ({ mountPoint, fstype }) => {
      const isAncestor = isAncestorOrSelf(mountPoint, resolved);
      // skipNetworkVolumes: don't stat() non-ancestor remote mount points —
      // a dead network mount would hang the lookup for an unrelated local
      // path. Ancestor candidates are still statted: if the target lives
      // under a remote mount, resolving the target already touched it, and
      // skipping ancestors would break lookups on healthy network mounts.
      if (
        !isAncestor &&
        opts.skipNetworkVolumes &&
        isRemoteFsType(fstype, opts.networkFsTypes)
      ) {
        return;
      }
      try {
        const mpDev = (await statAsync(mountPoint)).dev;
        if (mpDev !== targetDev) return;
        if (isAncestor) {
          prefixMatches.push(mountPoint);
        } else {
          deviceMatches.push(mountPoint);
        }
      } catch {
        // skip inaccessible mount points
      }
    }),
  );

  // Prefer ancestor matches — they're unambiguous. Fall back to device-only
  // matches only when the mount point isn't an ancestor (e.g. bind mounts).
  const candidates = prefixMatches.length > 0 ? prefixMatches : deviceMatches;
  if (candidates.length === 0) {
    throw new Error(
      "No mount point found for path: " + JSON.stringify(resolved),
    );
  }
  return candidates.reduce((a, b) => (a.length >= b.length ? a : b));
}

export async function getAllVolumeMetadataImpl(
  opts: Required<Options> & {
    includeSystemVolumes?: boolean;
    maxConcurrency?: number;
  },
  nativeFn: NativeBindingsFn,
): Promise<VolumeMetadata[]> {
  const o = optionsWithDefaults(opts);
  debug("[getAllVolumeMetadata] starting with options: %o", o);

  const arr = await getVolumeMountPointsImpl(o, nativeFn);
  debug("[getAllVolumeMetadata] found %d mount points", arr.length);

  const unhealthyMountPoints = arr
    .filter(
      (ea) => ea.status != null && ea.status !== VolumeHealthStatuses.healthy,
    )
    .map((ea) => ({
      mountPoint: ea.mountPoint,
      error: new WrappedError("volume not healthy: " + ea.status, {
        name: "Skipped",
      }),
    }));

  const includeSystemVolumes =
    opts?.includeSystemVolumes ?? IncludeSystemVolumesDefault;

  const systemMountPoints = includeSystemVolumes
    ? []
    : arr
        .filter((ea) => ea.isSystemVolume)
        .map((ea) => ({
          mountPoint: ea.mountPoint,
          error: new WrappedError("system volume", { name: "Skipped" }),
        }));

  const healthy = arr.filter(
    (ea) => ea.status == null || ea.status === VolumeHealthStatuses.healthy,
  );

  // On macOS and Windows, getVolumeMetadataImpl cannot cheaply detect remote
  // volumes before the native call, but the enumerated mount points carry
  // fstype — honor skipNetworkVolumes here with mount-point-derived shallow
  // results. (On Linux, getVolumeMetadataImpl itself short-circuits from the
  // mount table with richer remote info, so nothing is skipped here.)
  const skippedNetwork =
    o.skipNetworkVolumes && !isLinux
      ? healthy.filter((ea) => isRemoteFsType(ea.fstype, o.networkFsTypes))
      : [];
  const skippedNetworkResults = skippedNetwork.map(
    (ea) =>
      compactValues({ ...compactValues(ea), remote: true }) as VolumeMetadata,
  );

  debug("[getAllVolumeMetadata] ", {
    allMountPoints: arr.map((ea) => ea.mountPoint),
    healthyMountPoints: healthy.map((ea) => ea.mountPoint),
  });

  debug(
    "[getAllVolumeMetadata] processing %d healthy volumes with max concurrency %d",
    healthy.length,
    o.maxConcurrency,
  );

  const results = await (mapConcurrent({
    maxConcurrency: o.maxConcurrency,
    items: (includeSystemVolumes
      ? healthy
      : healthy.filter((ea) => !ea.isSystemVolume)
    ).filter((ea) => !skippedNetwork.includes(ea)),
    fn: async (mp) =>
      getVolumeMetadataImpl({ ...mp, ...o }, nativeFn).catch((error) => ({
        mountPoint: mp.mountPoint,
        error,
      })),
  }) as Promise<(VolumeMetadata | { mountPoint: string; error: Error })[]>);

  debug("[getAllVolumeMetadata] completed processing all volumes");
  return arr.map(
    (result) =>
      (results.find((ea) => ea.mountPoint === result.mountPoint) ??
        unhealthyMountPoints.find(
          (ea) => ea.mountPoint === result.mountPoint,
        ) ??
        systemMountPoints.find((ea) => ea.mountPoint === result.mountPoint) ??
        skippedNetworkResults.find(
          (ea) => ea.mountPoint === result.mountPoint,
        ) ?? {
          ...result,
          error: new WrappedError("Mount point metadata not retrieved", {
            name: "NotApplicableError",
          }),
        }) as VolumeMetadata,
  );
}
