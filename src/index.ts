// src/index.ts

import NodeGypBuild from "node-gyp-build";
import type {
  AvailableSpaceChange,
  AvailableSpaceChangeListener,
  AvailableSpaceState,
  AvailableSpaceStatus,
  AvailableSpaceWatcher,
  WatchAvailableSpaceOptions,
} from "./available_space_watcher";
import { watchAvailableSpaceImpl } from "./available_space_watcher";
import { debug, debugLogContext, isDebugEnabled } from "./debuglog";
import { defer } from "./defer";
import { _dirname } from "./dirname";
import { findAncestorDir } from "./fs";
import type { HideMethod, SetHiddenResult } from "./hidden";
import {
  getHiddenMetadataImpl,
  isHiddenImpl,
  isHiddenRecursiveImpl,
  setHiddenImpl,
} from "./hidden";
import { getMountPointForPathImpl } from "./mount_point_for_path";
import {
  getTimeoutMsDefault,
  IncludeSystemVolumesDefault,
  LinuxMountTablePathsDefault,
  NetworkFsTypesDefault,
  OptionsDefault,
  optionsWithDefaults,
  SkipNetworkVolumesDefault,
  SystemFsTypesDefault,
  SystemPathPatternsDefault,
} from "./options";
import {
  type PollingSubscription,
  type PollingWatcherOptions,
  PollIntervalMsDefault,
} from "./polling_watcher";
import type { StringEnum, StringEnumKeys, StringEnumType } from "./string_enum";
import type { SystemVolumeConfig } from "./system_volume";
import type { HiddenMetadata } from "./types/hidden_metadata";
import type { MountPoint } from "./types/mount_point";
import { NativeBindings } from "./types/native_bindings";
import type { Options, ResolvedOptions } from "./types/options";
import type { VolumeMetadata } from "./types/volume_metadata";
import type { VolumeHealthStatus } from "./volume_health_status";
import { VolumeHealthStatuses } from "./volume_health_status";
import {
  getAllVolumeMetadataImpl,
  getVolumeMetadataForPathImpl,
  getVolumeMetadataImpl,
} from "./volume_metadata";
import type { GetVolumeMountPointOptions } from "./volume_mount_points";
import { getVolumeMountPointsImpl } from "./volume_mount_points";
import type {
  VolumeMountChange,
  VolumeMountChangeListener,
  VolumeMountWatcher,
  WatchVolumeMountPointsOptions,
} from "./volume_mount_watcher";
import { watchVolumeMountPointsImpl } from "./volume_mount_watcher";

export type {
  AvailableSpaceChange,
  AvailableSpaceChangeListener,
  AvailableSpaceState,
  AvailableSpaceStatus,
  AvailableSpaceWatcher,
  GetVolumeMountPointOptions,
  HiddenMetadata,
  HideMethod,
  MountPoint,
  Options,
  PollingSubscription,
  PollingWatcherOptions,
  ResolvedOptions,
  SetHiddenResult,
  StringEnum,
  StringEnumKeys,
  StringEnumType,
  SystemVolumeConfig,
  VolumeHealthStatus,
  VolumeMetadata,
  VolumeMountChange,
  VolumeMountChangeListener,
  VolumeMountWatcher,
  WatchAvailableSpaceOptions,
  WatchVolumeMountPointsOptions,
};

const nativeFn = defer<Promise<NativeBindings>>(async () => {
  const start = Date.now();
  try {
    const dirname = _dirname();
    const dir = await findAncestorDir(dirname, "binding.gyp");
    if (dir == null) {
      throw new Error(
        "Could not find bindings.gyp in any ancestor directory of " + dirname,
      );
    }
    const bindings = NodeGypBuild(dir) as NativeBindings;
    bindings.setDebugLogging(isDebugEnabled());
    bindings.setDebugPrefix(debugLogContext() + ":native");
    return bindings;
  } catch (error) {
    debug("Loading native bindings failed: %s", error);
    throw error;
  } finally {
    debug(`Native bindings took %d ms to load`, Date.now() - start);
  }
});

/**
 * List all active local and remote mount points on the system.
 *
 * Linux file bind mounts are omitted after target probing; explicit path
 * queries still resolve and inspect them. When `skipNetworkVolumes` is true,
 * remote targets are not touched, so entries whose target type cannot be
 * determined are retained.
 *
 * Note that on Windows, `timeoutMs` will be used **per system call** and not
 * for the entire operation.
 *
 * @param opts Optional filesystem operation settings to override default values
 */
export function getVolumeMountPoints(
  opts?: Partial<GetVolumeMountPointOptions>,
): Promise<MountPoint[]> {
  return getVolumeMountPointsImpl(optionsWithDefaults(opts), nativeFn);
}

/**
 * Watch the process-visible mount-point set for additions and removals.
 *
 * This is a polling, eventually consistent state observer rather than a
 * lossless mount-operation log. The caller controls the delay between polls
 * with `pollIntervalMs`; it defaults to {@link PollIntervalMsDefault} (one
 * minute). A new poll starts only after the prior poll has fully settled.
 * `timeoutMs` bounds each caller-visible snapshot, but cannot cancel its
 * underlying native or filesystem work; after a timeout, another poll is not
 * scheduled until that raw work settles. On Linux, newly observed local paths
 * receive a directory probe with one quarter of that snapshot budget.
 *
 * Snapshots do not fetch capacity or accessibility status. On Linux, each
 * newly observed local path (including the initial set) gets one directory
 * probe to preserve the public directory-only mount-point behavior; remote
 * paths are never probed, and raw timed-out probes must settle before another
 * poll starts. On Windows, observation follows the current logical-drive-root
 * enumeration and does not include directory-mounted volume paths. Because
 * that shallow Windows enumeration does not query filesystem types, passing a
 * custom `systemFsTypes` filter throws. Windows snapshots contain only
 * `mountPoint` and the TypeScript-derived `isSystemVolume`; fields that require
 * touching the drive, including `fstype` and `isReadOnly`, are omitted.
 *
 * Existing mount points are returned by `watcher.ready`; they are not emitted
 * as additions. A transient later polling error is available as `lastError`
 * and through an `error` listener when one is registered, while the last good
 * snapshot is retained.
 */
export function watchVolumeMountPoints(
  opts: WatchVolumeMountPointsOptions = {},
  listener?: VolumeMountChangeListener,
): VolumeMountWatcher {
  return watchVolumeMountPointsImpl(opts, nativeFn, listener);
}

/**
 * Watch whether the filesystem containing `pathname` has at least a requested
 * number of bytes available to the current caller.
 *
 * The initial predicate state is returned by `watcher.ready`. The listener is
 * called only when the state crosses below the minimum or recovers above the
 * minimum plus `hysteresisBytes`. Polling errors and timeouts never manufacture
 * a low-space transition, and a timed-out filesystem request must settle before
 * another poll is scheduled.
 */
export function watchAvailableSpace(
  pathname: string,
  opts: WatchAvailableSpaceOptions,
  listener?: AvailableSpaceChangeListener,
): AvailableSpaceWatcher {
  return watchAvailableSpaceImpl(pathname, opts, listener);
}

/**
 * Get metadata for the volume at the given mount point.
 *
 * `timeoutMs` bounds the complete caller-visible operation on every platform.
 * It does not guarantee cancellation of a filesystem request already blocked
 * inside the operating system.
 *
 * @param mountPoint Must be a non-blank string. On Linux, this may be a file
 * that is itself a mount target.
 * @param opts Optional filesystem operation settings, including
 * {@link Options.skipNetworkVolumes} to avoid blocking on unreachable
 * network volumes
 */
export function getVolumeMetadata(
  mountPoint: string,
  opts?: Partial<
    Pick<
      Options,
      | "timeoutMs"
      | "skipNetworkVolumes"
      | "networkFsTypes"
      | "linuxMountTablePaths"
      | "includeZfsGuids"
    >
  >,
): Promise<VolumeMetadata> {
  return getVolumeMetadataImpl(
    { ...optionsWithDefaults(opts), mountPoint },
    nativeFn,
  );
}

/**
 * Get metadata for the volume that contains the given file or directory path.
 *
 * Unlike {@link getVolumeMetadata}, this accepts any path — not just mount
 * points. Symlinks are resolved, and macOS APFS firmlinks (e.g. `/Users` →
 * `/System/Volumes/Data`) are handled correctly, mirroring what `df` does.
 *
 * @param pathname Path to any file or directory
 * @param opts Optional filesystem operation settings
 */
export function getVolumeMetadataForPath(
  pathname: string,
  opts?: Partial<
    Pick<
      Options,
      | "timeoutMs"
      | "linuxMountTablePaths"
      | "mountPoints"
      | "skipNetworkVolumes"
      | "networkFsTypes"
      | "includeZfsGuids"
    >
  >,
): Promise<VolumeMetadata> {
  return getVolumeMetadataForPathImpl(
    pathname,
    optionsWithDefaults(opts),
    nativeFn,
  );
}

/**
 * Get the mount point path for an arbitrary file or directory path.
 *
 * This is a lightweight alternative to {@link getVolumeMetadataForPath} when
 * you only need the mount point string. On macOS it uses a single fstatfs()
 * call (no DiskArbitration, IOKit, or space calculations). On Linux/Windows
 * it uses device ID matching against the mount table: mount points that are
 * path ancestors of the target are preferred (deepest wins), and if none is
 * an ancestor, the longest same-device mount point is returned so that
 * bind-mounted paths still resolve to their canonical mount point. See
 * {@link Options.mountPoints} for the implications when supplying a custom
 * mount point array.
 *
 * Symlinks are resolved, and macOS APFS firmlinks (e.g. `/Users` →
 * `/System/Volumes/Data`) are handled correctly.
 *
 * @param pathname Path to any file or directory
 * @param opts Optional settings (timeoutMs, linuxMountTablePaths, mountPoints)
 * @returns The mount point path (e.g., "/", "/System/Volumes/Data", "C:\\").
 * On Linux this may be a file when the input is itself a file bind mount.
 */
export function getMountPointForPath(
  pathname: string,
  opts?: Partial<
    Pick<
      Options,
      | "timeoutMs"
      | "linuxMountTablePaths"
      | "mountPoints"
      | "skipNetworkVolumes"
      | "networkFsTypes"
    >
  >,
): Promise<string> {
  return getMountPointForPathImpl(
    pathname,
    optionsWithDefaults(opts),
    nativeFn,
  );
}

/**
 * Retrieves metadata for all mounted volumes with optional filtering and
 * concurrency control.
 *
 * @param opts - Optional configuration object
 * @param opts.includeSystemVolumes - If true, includes system volumes in the
 * results. Defaults to true on Windows and false elsewhere.
 * @param opts.maxConcurrency - Maximum number of concurrent operations.
 * Defaults to `UV_THREADPOOL_SIZE` plus a little headroom, capped by
 * {@link https://nodejs.org/api/os.html#osavailableparallelism | os.availableParallelism()}
 * @param opts.timeoutMs - Maximum time to wait for
 * {@link getVolumeMountPointsImpl}, as well as **each** {@link getVolumeMetadataImpl}
 * to complete. Defaults to {@link getTimeoutMsDefault}
 * @returns Promise that resolves to an array of either VolumeMetadata objects
 * or error objects containing the mount point and error
 * @throws Never - errors are caught and returned as part of the result array
 */
export function getAllVolumeMetadata(
  opts?: Partial<Options> & { includeSystemVolumes?: boolean },
): Promise<VolumeMetadata[]> {
  return getAllVolumeMetadataImpl(optionsWithDefaults(opts), nativeFn);
}

/**
 * Check if a file or directory is hidden.
 *
 * Note that `path` may be _effectively_ hidden if any of the ancestor
 * directories are hidden: use {@link isHiddenRecursive} to check for this.
 *
 * @param pathname Path to file or directory
 * @returns Promise resolving to boolean indicating hidden state
 */
export function isHidden(pathname: string): Promise<boolean> {
  return isHiddenImpl(pathname, nativeFn);
}

/**
 * Check if a file or directory is hidden, or if any of its ancestor
 * directories are hidden.
 *
 * @param pathname Path to file or directory
 * @returns Promise resolving to boolean indicating hidden state
 */
export function isHiddenRecursive(pathname: string): Promise<boolean> {
  return isHiddenRecursiveImpl(pathname, nativeFn);
}

/**
 * Get detailed metadata about the hidden state of a file or directory.
 *
 * @param pathname Path to file or directory
 * @returns Promise resolving to metadata about the hidden state
 */
export function getHiddenMetadata(pathname: string): Promise<HiddenMetadata> {
  return getHiddenMetadataImpl(pathname, nativeFn);
}

/**
 * Set the hidden state of a file or directory
 *
 * @param pathname Path to file or directory
 * @param hidden - Whether the item should be hidden (true) or visible (false)
 * @param method Method to use for hiding the file or directory. The default
 * is "auto", which is "dotPrefix" on Linux and macOS, and "systemFlag" on
 * Windows. "all" will attempt to use all relevant methods for the current
 * operating system.
 * @returns Promise resolving the final name of the file or directory (as it
 * will change on POSIX systems), and the action(s) taken.
 * @throws {Error} If the file doesn't exist, permissions are insufficient, or
 * the requested method is unsupported
 */
export function setHidden(
  pathname: string,
  hidden: boolean,
  method: HideMethod = "auto",
): Promise<SetHiddenResult> {
  return setHiddenImpl(pathname, hidden, method, nativeFn);
}

export {
  getTimeoutMsDefault,
  IncludeSystemVolumesDefault,
  LinuxMountTablePathsDefault,
  NetworkFsTypesDefault,
  OptionsDefault,
  optionsWithDefaults,
  PollIntervalMsDefault,
  SkipNetworkVolumesDefault,
  SystemFsTypesDefault,
  SystemPathPatternsDefault,
  VolumeHealthStatuses,
};
