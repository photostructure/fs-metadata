// src/index.ts

import NodeGypBuild from "node-gyp-build";
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
import {
  getTimeoutMsDefault,
  IncludeSystemVolumesDefault,
  LinuxMountTablePathsDefault,
  OptionsDefault,
  optionsWithDefaults,
  SystemFsTypesDefault,
  SystemPathPatternsDefault,
} from "./options";
import type { StringEnum, StringEnumKeys, StringEnumType } from "./string_enum";
import type { SystemVolumeConfig } from "./system_volume";
import type { HiddenMetadata } from "./types/hidden_metadata";
import type { MountPoint } from "./types/mount_point";
import { NativeBindings } from "./types/native_bindings";
import type { Options } from "./types/options";
import type { VolumeMetadata } from "./types/volume_metadata";
import type { VolumeHealthStatus } from "./volume_health_status";
import { VolumeHealthStatuses } from "./volume_health_status";
import {
  getAllVolumeMetadataImpl,
  getVolumeMetadataImpl,
} from "./volume_metadata";
import type { GetVolumeMountPointOptions } from "./volume_mount_points";
import { getVolumeMountPointsImpl } from "./volume_mount_points";

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
 * Only readable directories are included in the results.
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
 * Get metadata for the volume at the given mount point.
 *
 * @param mountPoint Must be a non-blank string
 * @param opts Optional filesystem operation settings
 */
export function getVolumeMetadata(
  mountPoint: string,
  opts?: Partial<Pick<Options, "timeoutMs">>,
): Promise<VolumeMetadata> {
  return getVolumeMetadataImpl(
    { ...optionsWithDefaults(opts), mountPoint },
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
 * Defaults to the system's available parallelism: see
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
  OptionsDefault,
  optionsWithDefaults,
  SystemFsTypesDefault,
  SystemPathPatternsDefault,
  VolumeHealthStatuses,
};
