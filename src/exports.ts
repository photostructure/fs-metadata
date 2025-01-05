// src/exports.ts

import type { HideMethod, SetHiddenResult } from "./hidden.js";
import type { Options } from "./options.js";
import {
  IncludeSystemVolumesDefault,
  LinuxMountTablePathsDefault,
  OptionsDefault,
  optionsWithDefaults,
  SystemFsTypesDefault,
  SystemPathPatternsDefault,
  TimeoutMsDefault,
} from "./options.js";
import type {
  StringEnum,
  StringEnumKeys,
  StringEnumType,
} from "./string_enum.js";
import type { SystemVolumeConfig } from "./system_volume.js";
import type { HiddenMetadata } from "./types/hidden_metadata.js";
import type { MountPoint } from "./types/mount_point.js";
import type { VolumeMetadata } from "./types/volume_metadata.js";
import type { VolumeHealthStatus } from "./volume_health_status.js";
import { VolumeHealthStatuses } from "./volume_health_status.js";
import type { GetVolumeMountPointOptions } from "./volume_mount_points.js";

export type {
  GetVolumeMountPointOptions,
  HiddenMetadata,
  HideMethod,
  MountPoint,
  Options,
  SetHiddenResult,
  StringEnum,
  StringEnumKeys,
  StringEnumType,
  SystemVolumeConfig,
  VolumeHealthStatus,
  VolumeMetadata,
};

/**
 * List all active local and remote mount points on the system.
 *
 * Only readable directories are included in the results.
 *
 * Note that on Windows, `timeoutMs` will be used **per system call** and not
 * for the entire operation.
 *
 * @param opts Optional filesystem operation settings to override default values
 */
export declare function getVolumeMountPoints(
  opts?: Partial<GetVolumeMountPointOptions>,
): Promise<MountPoint[]>;

/**
 * Get metadata for the volume at the given mount point.
 *
 * @param mountPoint Must be a non-blank string
 * @param opts Optional filesystem operation settings
 */
export declare function getVolumeMetadata(
  mountPoint: string,
  opts?: Partial<Pick<Options, "timeoutMs">>,
): Promise<VolumeMetadata>;

/**
 * Retrieves metadata for all mounted volumes with optional filtering and
 * concurrency control.
 *
 * @param opts - Optional configuration object
 * @param opts.includeSystemVolumes - If true, includes system volumes in the
 * results. Defaults to true on Windows and false elsewhere.
 * @param opts.maxConcurrency - Maximum number of concurrent operations.
 * Defaults to the system's available parallelism: see
 * {@link https://nodejs.org/api/os.html#osavailableparallelism | os.availableParallelism()}
 * @param opts.timeoutMs - Maximum time to wait for
 * {@link getVolumeMountPoints}, as well as **each** {@link getVolumeMetadata}
 * to complete. Defaults to {@link TimeoutMsDefault}
 * @returns Promise that resolves to an array of either VolumeMetadata objects
 * or error objects containing the mount point and error
 * @throws Never - errors are caught and returned as part of the result array
 */
export declare function getAllVolumeMetadata(
  opts?: Partial<Options> & { includeSystemVolumes?: boolean },
): Promise<VolumeMetadata[]>;

/**
 * Check if a file or directory is hidden.
 *
 * Note that `path` may be _effectively_ hidden if any of the ancestor
 * directories are hidden: use {@link isHiddenRecursive} to check for this.
 *
 * @param pathname Path to file or directory
 * @returns Promise resolving to boolean indicating hidden state
 */
export declare function isHidden(pathname: string): Promise<boolean>;

/**
 * Check if a file or directory is hidden, or if any of its ancestor
 * directories are hidden.
 *
 * @param pathname Path to file or directory
 * @returns Promise resolving to boolean indicating hidden state
 */
export declare function isHiddenRecursive(pathname: string): Promise<boolean>;

/**
 * Get detailed metadata about the hidden state of a file or directory.
 *
 * @param pathname Path to file or directory
 * @returns Promise resolving to metadata about the hidden state
 */
export declare function getHiddenMetadata(
  pathname: string,
): Promise<HiddenMetadata>;

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
export declare function setHidden(
  pathname: string,
  hidden: boolean,
  method?: HideMethod,
): Promise<SetHiddenResult>;

export type ExportedFunctions = {
  getVolumeMountPoints: typeof getVolumeMountPoints;
  getVolumeMetadata: typeof getVolumeMetadata;
  getAllVolumeMetadata: typeof getAllVolumeMetadata;
  isHidden: typeof isHidden;
  isHiddenRecursive: typeof isHiddenRecursive;
  getHiddenMetadata: typeof getHiddenMetadata;
  setHidden: typeof setHidden;
};

export {
  IncludeSystemVolumesDefault,
  LinuxMountTablePathsDefault,
  OptionsDefault,
  optionsWithDefaults,
  SystemFsTypesDefault,
  SystemPathPatternsDefault,
  TimeoutMsDefault,
  VolumeHealthStatuses,
};
