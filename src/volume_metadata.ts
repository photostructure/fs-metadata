// src/volume_metadata.ts

import type { Stats } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname } from "node:path";
import {
  TimeoutError,
  mapConcurrent,
  validateTimeoutMs,
  withTimeout,
} from "./async";
import { debug } from "./debuglog";
import { WrappedError, toError } from "./error";
import { canReaddir, statAsync, statfsAsync } from "./fs";
import { getLabelFromDevDisk, getUuidFromDevDisk } from "./linux/dev_disk";
import {
  getContainingMountEntry,
  getLinuxMtabMetadata,
} from "./linux/mount_points";
import {
  type MountEntry,
  type MtabVolumeMetadata,
  mountEntryToPartialVolumeMetadata,
} from "./linux/mtab";
import { findSubvolumeRoot, isBtrfsPath } from "./linux/subvolume";
import { getZfsGuids, zfsEnrichmentTimeoutMs } from "./linux/zfs_guids";
import { compactValues } from "./object";
import { IncludeSystemVolumesDefault, optionsWithDefaults } from "./options";
import { isAncestorOrSelf, normalizePath } from "./path";
import { isLinux, isMacOS, isWindows } from "./platform";
import { extractRemoteInfo, isRemoteFsType } from "./remote_info";
import { isBlank, isNotBlank } from "./string";
import { assignSystemVolume } from "./system_volume";
import type { MountPoint } from "./types/mount_point";
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
  operationDeadlineMs?: number,
  statImpl: typeof statAsync = statAsync,
  statfsImpl: typeof statfsAsync = statfsAsync,
): Promise<VolumeMetadata> {
  if (isBlank(o.mountPoint)) {
    throw new TypeError(
      "Invalid mountPoint: got " + JSON.stringify(o.mountPoint),
    );
  }

  // Validate before starting any work (including native calls) — also on
  // Windows, where the native health probe also receives this timeout.
  const timeoutMs = validateTimeoutMs(o.timeoutMs, "getVolumeMetadata()");
  const deadlineMs =
    operationDeadlineMs ??
    (timeoutMs === 0 ? undefined : Date.now() + timeoutMs);
  const p = _getVolumeMetadata(o, nativeFn, deadlineMs, statImpl, statfsImpl);
  return withTimeout({
    desc: "getVolumeMetadata()",
    timeoutMs,
    promise: p,
  });
}

async function _getVolumeMetadata(
  o: GetVolumeMetadataOptions & Options,
  nativeFn: NativeBindingsFn,
  deadlineMs: number | undefined,
  statImpl: typeof statAsync = statAsync,
  statfsImpl: typeof statfsAsync = statfsAsync,
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
  let mountEntry: undefined | MountEntry;
  // The path whose identity we report. It differs from o.mountPoint only on
  // the nested-subvolume fallback below, where symlinks must be resolved.
  let identityPath = o.mountPoint;
  // On Linux, read the mount table before touching the mount point: it comes
  // from /proc (or /etc/mtab) and never blocks on the volume itself, so
  // remote-ness is known before any IO that could hang on a dead mount.
  if (isLinux) {
    debug("[getVolumeMetadata] collecting Linux mtab info");
    try {
      mountEntry = await getLinuxMtabMetadata(o.mountPoint, o);
    } catch (err) {
      debug("[getVolumeMetadata] failed to get mtab info: " + err);
      // Mtab lookup can fail for transient mounts or race conditions.
      // Ignore and continue with whatever the native call returns.

      // A btrfs subvolume nested inside a mounted filesystem has no mount entry
      // of its own, so an exact-path lookup cannot find one. Fall back to the
      // mount that contains it — but only with the same corroboration
      // resolveMountPoint() demands, so no other unlisted path silently
      // acquires an ancestor's identity.
      // Resolve symlinks first. getContainingMountEntry() matches lexically, so
      // a symlink under a btrfs mount that points into a DIFFERENT filesystem
      // would otherwise take its uuid, mountFrom, and device from the mount the
      // link lives under, while the ioctl reported the target's subvolume —
      // one result object describing two block devices. getVolumeMetadataForPath()
      // resolves its own input; this is the direct-call route.
      const real = await realpath(o.mountPoint).catch(() => o.mountPoint);
      const containing = await getContainingMountEntry(real, o);
      if (
        containing?.fs_vfstype === "btrfs" &&
        (await isBtrfsPath(real, statfsImpl))
      ) {
        debug(
          "[getVolumeMetadata] %s is nested under btrfs mount %s",
          real,
          containing.fs_file,
        );
        mountEntry = containing;
        identityPath = real;
      }
    }
    if (mountEntry != null) {
      mtabInfo = mountEntryToPartialVolumeMetadata(mountEntry, o);
      debug("[getVolumeMetadata] mtab info: %o", mtabInfo);
      if (mtabInfo.remote) {
        remote = true;
      }
      if (isNotBlank(mountEntry.fs_spec)) {
        device = mountEntry.fs_spec;
      }
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

  // The macOS native directory open performs this validation off libuv.
  // A redundant JS opendir would leave a joined worker behind on timeout.
  const pathStatus = isMacOS
    ? { status: VolumeHealthStatuses.healthy, isDirectory: true }
    : await directoryStatus(o.mountPoint, o.timeoutMs);
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

  // On btrfs, identity belongs to the subvolume, not to the mount: several
  // subvolumes share one filesystem uuid, and a nested one has no mount entry
  // at all. Probe the subvolume's own root directory so the ioctl answers for
  // the subvolume that owns the queried path — for an ordinary mount that is
  // the mount point itself, and for a file it is the containing directory.
  const subvolumeRoot =
    mountEntry?.fs_vfstype === "btrfs"
      ? await findSubvolumeRoot(identityPath, mountEntry.fs_file, statImpl)
      : undefined;

  // The subvolume ioctl needs a directory descriptor. For an ordinary file,
  // probe its parent: the ioctl reports the owning subvolume either way, and
  // otherwise a direct getVolumeMetadata(file) silently loses the
  // subvolumeUuid, subvolid, and read-only flag that
  // getVolumeMetadataForPath() returns for that same file. A file that is
  // itself a mount target keeps its own path — that mount IS the volume being
  // asked about.
  let probePath = identityPath;
  if (
    mountEntry?.fs_vfstype === "btrfs" &&
    identityPath !== mountEntry.fs_file
  ) {
    const st = await statImpl(identityPath).catch(() => undefined);
    if (st?.isDirectory() === false) probePath = dirname(identityPath);
  }

  debug("[getVolumeMetadata] requesting native metadata");
  if (isMacOS && deadlineMs != null) {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) throw new TimeoutError("getVolumeMetadata(): timeout");
    o.timeoutMs = remaining;
  }
  const metadata = (await (
    await nativeFn()
  )
    .getVolumeMetadata(
      // Probe the queried path itself, NOT subvolumeRoot: the ioctl reports the
      // owning subvolume for any directory within it, and the subvolume root
      // can be traversable but unreadable (mode 711), which would turn a
      // readable child into EACCES.
      probePath === o.mountPoint ? o : { ...o, mountPoint: probePath },
    )
    .catch((error: unknown) => {
      throw toError(error);
    })) as VolumeMetadata;
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

  // `mountPoint` means "what findmnt would say". When the caller asked about a
  // path inside a nested subvolume, that is the containing mount — the
  // subvolume itself is not mounted, and `subvolumeRoot` is where it begins.
  const mountPoint = mountEntry?.fs_file ?? o.mountPoint;

  // When the queried path belongs to a subvolume other than the one the mount
  // exposes, the mount's `subvol=`/`subvolid=` options describe a *different*
  // subvolume. Drop them rather than pair them with this subvolume's uuid:
  // `subvol` has no value here (there is no mount option to read), and
  // `subvolid` comes from the ioctl instead.
  const nestedSubvolume = subvolumeRoot != null && subvolumeRoot !== mountPoint;

  debug("[getVolumeMetadata] assembling: %o", {
    status,
    mtabInfo,
    remoteInfo,
    metadata,
    mountPoint,
    subvolumeRoot,
    remote,
  });
  const result = compactValues({
    status, // < let the implementation's status win by having this first
    ...compactValues(remoteInfo),
    ...compactValues(metadata),
    ...compactValues(mtabInfo),
    ...(nestedSubvolume
      ? { subvol: undefined, subvolid: metadata.subvolid }
      : {}),
    subvolumeRoot,
    // A read-only subvolume under a read-write mount is still read-only, and
    // only the ioctl sees that: statfs()'s ST_RDONLY stays clear for it.
    isReadOnly:
      (mtabInfo?.isReadOnly ?? false) || (metadata.isReadOnly ?? false),
    mountPoint,
    remote,
  }) as VolumeMetadata;

  // Backfill if blkid failed us:
  if (isLinux && isNotBlank(device)) {
    // Sometimes blkid doesn't have the UUID in cache. Try to get it from
    // /dev/disk/by-uuid:
    result.uuid ??= (await getUuidFromDevDisk(device)) ?? "";
    result.label ??= (await getLabelFromDevDisk(device)) ?? "";
  }

  if (
    isLinux &&
    o.includeZfsGuids &&
    result.fstype === "zfs" &&
    isNotBlank(result.mountFrom)
  ) {
    // Reserve part of the whole-operation deadline for command-timeout cleanup
    // and final result assembly. If earlier filesystem work consumed
    // the budget, optional enrichment is skipped instead of racing the public
    // timeout. A timeout of zero deliberately disables both deadlines.
    const commandTimeoutMs = zfsEnrichmentTimeoutMs(deadlineMs, Date.now());
    if (commandTimeoutMs != null) {
      Object.assign(
        result,
        await getZfsGuids({
          dataset: result.mountFrom,
          timeoutMs: commandTimeoutMs,
        }),
      );
    } else {
      debug("[getVolumeMetadata] skipping ZFS GUIDs: deadline exhausted");
    }
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
  statImpl: typeof statAsync = statAsync,
  statfsImpl: typeof statfsAsync = statfsAsync,
): Promise<VolumeMetadata> {
  if (isBlank(pathname)) {
    throw new TypeError("Invalid pathname: got " + JSON.stringify(pathname));
  }

  // Validate before any path work: with a caller-supplied opts.mountPoints
  // this route can otherwise finish (or fail for unrelated reasons) without
  // ever reaching a timeoutMs check.
  const timeoutMs = validateTimeoutMs(
    opts.timeoutMs,
    "getVolumeMetadataForPath()",
  );

  // This deadline wraps the WHOLE operation, including realpath()/stat() and the
  // nested getVolumeMetadataImpl() call inside _getVolumeMetadataForPath().
  // getVolumeMetadataImpl() has its own withTimeout(), but that inner one only
  // starts after path resolution, so this outer wrapper is what bounds a hung
  // realpath(). The two are intentional — don't drop this as "redundant".
  const operationDeadlineMs =
    timeoutMs === 0 ? undefined : Date.now() + timeoutMs;
  return withTimeout({
    desc: "getVolumeMetadataForPath()",
    timeoutMs,
    promise: _getVolumeMetadataForPath(
      pathname,
      opts,
      nativeFn,
      resolvePath,
      operationDeadlineMs,
      statImpl,
      statfsImpl,
    ),
  });
}

async function _getVolumeMetadataForPath(
  pathname: string,
  opts: Options,
  nativeFn: NativeBindingsFn,
  resolvePath: typeof realpath,
  operationDeadlineMs: number | undefined,
  statImpl: typeof statAsync = statAsync,
  statfsImpl: typeof statfsAsync = statfsAsync,
): Promise<VolumeMetadata> {
  if (isMacOS) {
    const native = await nativeFn();
    if (!native.getMountPoint)
      throw new Error("getMountPoint native function unavailable");
    const mountPoint = await native
      .getMountPoint(pathname, opts)
      .catch((error: unknown) => {
        throw toError(error);
      });
    return getVolumeMetadataImpl(
      { ...opts, mountPoint },
      nativeFn,
      operationDeadlineMs,
    );
  }
  // Resolve symlinks before matching Linux/Windows device IDs and ancestors.
  const resolved = await resolvePath(pathname);

  // Keep the original path so an exact Linux file bind mount remains
  // distinguishable from its containing directory.
  const resolvedStat = await statImpl(resolved);

  // The subvolume ioctl needs a directory, so a file is asked about through
  // the directory that contains it.
  const dir = resolvedStat.isDirectory() ? resolved : dirname(resolved);

  // Linux/Windows: stat().dev is reliable (no firmlinks). Find the mount point
  // by comparing device IDs, using path prefix as a tiebreaker for bind mounts
  // or GVfs/FUSE mounts that share the same device id.
  const resolution = await resolveMountPoint(
    resolved,
    resolvedStat,
    opts,
    nativeFn,
    statImpl,
    undefined,
    statfsImpl,
  );

  return getVolumeMetadataImpl(
    {
      ...opts,
      // A nested btrfs subvolume shares its containing mount's mount point but
      // not its identity, so keep asking about the path itself: querying
      // `resolution.mountPoint` would return the mount's subvolume instead.
      mountPoint: resolution.nested ? dir : resolution.mountPoint,
    },
    nativeFn,
    operationDeadlineMs,
    statImpl,
    statfsImpl,
  );
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
 * The device-only fallback exists for bind mounts where the canonical mount
 * point may not be a path ancestor of the target.
 *
 * Resolution runs in two phases because ancestor matches win outright whenever
 * there are any: the non-ancestor stats cannot change the answer unless no
 * ancestor is on the target's device. `isAncestorOrSelf()` is pure string work,
 * so partitioning first costs nothing and normally reduces a full-system list
 * (57 mount points on a typical Linux desktop) to the 2-3 that are actually
 * ancestors.
 *
 * That matters beyond latency. One unreachable mount point — a dead `autofs`
 * trigger, an unplugged `x-systemd.automount`, a wedged FUSE mount — blocks
 * `stat()` for seconds, and `fsp.stat()` has no cancellation: a timeout would
 * abandon the promise while the libuv thread stays parked. Embedders that have
 * not raised `UV_THREADPOOL_SIZE` (default 4) would have unrelated filesystem
 * work starve behind it on every lookup. Not issuing the stat is the only
 * remedy.
 */
export async function findMountPointByDeviceId(
  resolved: string,
  resolvedStat: Stats,
  opts: Options,
  nativeFn: NativeBindingsFn,
  statImpl: typeof statAsync = statAsync,
  canReaddirImpl: typeof canReaddir = canReaddir,
  statfsImpl: typeof statfsAsync = statfsAsync,
): Promise<string> {
  return (
    await resolveMountPoint(
      resolved,
      resolvedStat,
      opts,
      nativeFn,
      statImpl,
      canReaddirImpl,
      statfsImpl,
    )
  ).mountPoint;
}

/** What {@link resolveMountPoint} matched, and how. */
export interface MountPointResolution {
  /** The mount point the path resolves to. */
  mountPoint: string;
  /**
   * True when the path's device matched no mount entry and it was resolved to
   * the btrfs mount containing it: the path is inside a subvolume the mount
   * table does not name. Callers that want the path's own identity — rather
   * than the mount's — must keep querying the path, not `mountPoint`.
   */
  nested: boolean;
}

/** @see findMountPointByDeviceId */
export async function resolveMountPoint(
  resolved: string,
  resolvedStat: Stats,
  opts: Options,
  nativeFn: NativeBindingsFn,
  statImpl: typeof statAsync = statAsync,
  canReaddirImpl: typeof canReaddir = canReaddir,
  statfsImpl: typeof statfsAsync = statfsAsync,
): Promise<MountPointResolution> {
  const targetDev = resolvedStat.dev;
  const mountPoints =
    opts.mountPoints ??
    (await getVolumeMountPointsImpl(
      {
        ...opts,
        includeSystemVolumes: true,
        includeNonDirectoryMountPoints: true,
        // Ancestor-only stat() below is pointless if simply *obtaining* the
        // candidate list readdir()s every mount first: one dead mount would
        // still delay every lookup by the probe budget. Nothing here reads
        // `status`, and includeNonDirectoryMountPoints already disables the
        // only filter the probe feeds, so the probe is pure cost.
        skipHealthProbes: true,
      },
      nativeFn,
      canReaddirImpl,
    ));

  const sameDeviceMountPoints = async (candidates: MountPoint[]) => {
    const matches: string[] = [];
    await Promise.all(
      candidates.map(async ({ mountPoint }) => {
        try {
          if ((await statImpl(mountPoint)).dev === targetDev) {
            matches.push(mountPoint);
          }
        } catch {
          // skip inaccessible mount points
        }
      }),
    );
    return matches;
  };

  const ancestors: MountPoint[] = [];
  const nonAncestors: MountPoint[] = [];
  for (const mp of mountPoints) {
    (isAncestorOrSelf(mp.mountPoint, resolved) ? ancestors : nonAncestors).push(
      mp,
    );
  }

  // Phase 1: ancestors only. These are all on the path realpath() already
  // traversed, so they are reachable by construction.
  const prefixMatches = await sameDeviceMountPoints(ancestors);
  const deviceMatch =
    prefixMatches.length > 0 ? longestPath(prefixMatches) : undefined;

  // Phase 2: on btrfs, path ancestry outranks the device match.
  //
  // A btrfs anonymous st_dev names the SUBVOLUME, not the mount, which makes it
  // a poor mount discriminator in two ways. It is absent for a subvolume with
  // no mount entry of its own, so nothing matches. And it is ambiguous when one
  // subvolume is mounted twice: with `@` mounted at / and the same filesystem's
  // top-level tree at /mnt/all — the standard snapshot-management layout —
  // /mnt/all/@/photos is inside @, so it device-matches / even though the mount
  // it actually traverses is /mnt/all. Taking / there reports a subvolumeRoot of
  // /, and relative() then yields "mnt/all/@/photos" instead of "photos".
  //
  // The deepest btrfs ancestor is the mount the path really goes through.
  // statfs() corroborates that the target is on btrfs first, and only runs when
  // a btrfs ancestor is deeper than whatever the device matched — so the common
  // case costs no extra syscall.
  const btrfsAncestors = ancestors.filter(({ fstype }) => fstype === "btrfs");
  const deepestBtrfs =
    btrfsAncestors.length > 0
      ? longestPath(btrfsAncestors.map((ea) => ea.mountPoint))
      : undefined;
  if (
    deepestBtrfs != null &&
    (deviceMatch == null || deepestBtrfs.length > deviceMatch.length) &&
    (await isBtrfsPath(resolved, statfsImpl))
  ) {
    debug(
      "[resolveMountPoint] %s traverses btrfs mount %s (device matched %s)",
      resolved,
      deepestBtrfs,
      deviceMatch,
    );
    // Reaching here means this mount's device did NOT match the target's, so
    // the path's subvolume is not the one the mount exposes. Callers must keep
    // querying the path itself to get its identity.
    return { mountPoint: deepestBtrfs, nested: true };
  }

  if (deviceMatch != null) {
    return { mountPoint: deviceMatch, nested: false };
  }

  // Phase 3: the bind-mount fallback, reached only when nothing on the target's
  // own path matched. skipNetworkVolumes: don't stat() non-ancestor remote
  // mount points — a dead network mount would hang the lookup for an unrelated
  // local path. Ancestors are exempt above: if the target lives under a remote
  // mount, resolving it already touched that mount, and skipping ancestors
  // would break lookups on healthy network volumes.
  const deviceMatches = await sameDeviceMountPoints(
    nonAncestors.filter(
      ({ fstype }) =>
        !(
          opts.skipNetworkVolumes && isRemoteFsType(fstype, opts.networkFsTypes)
        ),
    ),
  );
  if (deviceMatches.length > 0) {
    return { mountPoint: longestPath(deviceMatches), nested: false };
  }

  throw new Error("No mount point found for path: " + JSON.stringify(resolved));
}

/** The most specific of several matching mount points. */
function longestPath(paths: string[]): string {
  return paths.reduce((a, b) => (a.length >= b.length ? a : b));
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
