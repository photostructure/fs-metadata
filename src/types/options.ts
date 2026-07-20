// src/types/options.ts

import type { MountPoint } from "./mount_point";

/**
 * Configuration options for filesystem operations.
 *
 * @see {@link optionsWithDefaults} for creating an options object with default values
 * @see {@link OptionsDefault} for the default values
 */
export interface Options {
  /**
   * Pre-fetched mount points to use instead of querying the system.
   *
   * When provided, functions like {@link getMountPointForPath} and
   * {@link getVolumeMetadataForPath} will use these mount points for device ID
   * matching instead of calling {@link getVolumeMountPoints} internally. This
   * avoids redundant system queries when resolving multiple paths.
   *
   * Obtain via `getVolumeMountPoints({ includeSystemVolumes: true })` — system
   * volumes must be included for device ID matching to work correctly.
   * On Linux that public list intentionally omits detected file mount targets.
   * Remote targets are not classified when `skipNetworkVolumes` is true. Omit
   * this option when resolving a path that may itself be a file bind mount, or
   * include that exact target in a custom array.
   *
   * On Linux and Windows, resolution prefers entries that are path ancestors
   * of the target. If this array contains no ancestor of the target path, a
   * same-device entry that is *not* an ancestor may be returned instead. That
   * fallback is intentional (it lets bind-mounted paths resolve to their
   * canonical mount point), but it means an incomplete or hand-picked array
   * can match an entry with no path relationship to the target.
   */
  mountPoints?: MountPoint[];
  /**
   * Timeout in milliseconds for filesystem operations.
   *
   * Disable timeouts by setting this to 0.
   *
   * @see {@link getTimeoutMsDefault}.
   */
  timeoutMs: number;

  /**
   * Maximum number of concurrent filesystem operations.
   *
   * Defaults to {@link https://nodejs.org/api/os.html#osavailableparallelism | availableParallelism}.
   */
  maxConcurrency: number;

  /**
   * On Linux and macOS, mount point pathnames that matches any of these glob
   * patterns will have {@link MountPoint.isSystemVolume} set to true.
   *
   * @see {@link SystemPathPatternsDefault} for the default value
   */
  systemPathPatterns: string[];

  /**
   * On Linux and macOS, volumes whose filesystem matches any of these strings
   * will have {@link MountPoint.isSystemVolume} set to true.
   *
   * @see {@link SystemFsTypesDefault} for the default value
   */
  systemFsTypes: string[];

  /**
   * On Linux, use the first mount point table in this array that is readable.
   *
   * @see {@link LinuxMountTablePathsDefault} for the default values
   */
  linuxMountTablePaths: string[];

  /**
   * Filesystem types that indicate network/remote volumes.
   *
   * @see {@link NetworkFsTypesDefault} for the default value
   */
  networkFsTypes: string[];

  /**
   * Should system volumes be included in result arrays? Defaults to true on
   * Windows and false elsewhere.
   */
  includeSystemVolumes: boolean;

  /**
   * Skip the detailed (potentially blocking) volume queries for network
   * volumes. Defaults to false.
   *
   * When enabled, remote volumes return shallow metadata derived from the
   * mount table or mount-point enumeration instead of probing the volume:
   * `size`/`used`/`available`, `label`, and `uuid` are omitted, and `remote`
   * is true.
   *
   * - On Linux, `getVolumeMetadata()` detects remote volumes from the mount
   *   table (which never touches the mount point itself) and returns
   *   `status: "unknown"` without any filesystem IO on the volume.
   * - On macOS and Windows, single-volume `getVolumeMetadata()` calls cannot
   *   cheaply detect remote-ness up front, so only `getAllVolumeMetadata()`
   *   honors this option there, using the fstype from mount-point
   *   enumeration matched against {@link Options.networkFsTypes}. Note that
   *   Windows drive letters mapped to network shares report the remote
   *   server's filesystem (typically `NTFS`), so mapped drives may still be
   *   probed. `timeoutMs` bounds each single-volume metadata call (applied per
   *   volume by `getAllVolumeMetadata()`, not as one global deadline) and
   *   native drive checks use adaptive Windows callback-pool capacity, but a
   *   blocked OS request may continue in the background because cancellation is
   *   provider-dependent.
   * - Path resolution ({@link getVolumeMetadataForPath},
   *   {@link getMountPointForPath}) skips `stat()`ing remote mount points
   *   that are not path ancestors of the target, so a dead network mount
   *   cannot hang lookups for unrelated local paths.
   */
  skipNetworkVolumes: boolean;
}
