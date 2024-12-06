// index.ts
import NodeGypBuild from "node-gyp-build";
import { availableParallelism } from "node:os";
import { mapConcurrent, thenOrTimeout } from "./async.js";
import { defer } from "./defer.js";
import { findAncestorDir } from "./fs.js";
import {
  getHiddenMetadata,
  HiddenMetadata,
  HideMethod,
  isHidden,
  isHiddenRecursive,
  setHidden,
} from "./hidden.js";
import {
  GetVolumeMountPointOptions,
  getVolumeMountPoints,
  MountPoint,
} from "./mount_point.js";
import type { NativeBindings } from "./native_bindings.js";
import { toGt0 } from "./number.js";
import { type Options, optionsWithDefaults } from "./options.js";
import { getVolumeMetadata, type VolumeMetadata } from "./volume_metadata.js";

/**
 * Glue code between the native bindings and the rest of the library to make
 * things simpler for index.ts and index.cts with the management of the native
 * bindings.
 */
export class ExportsImpl {
  constructor(readonly _dirname: string) {}

  readonly #nativeFn = defer(async () => {
    const dir = await findAncestorDir(this._dirname, "binding.gyp");
    if (dir == null) {
      throw new Error(
        "Could not find bindings.gyp in any ancestor directory of " +
          this._dirname,
      );
    }
    return NodeGypBuild(dir) as NativeBindings;
  });

  /**
   * List all active local and remote mount points on the system.
   *
   * Only readable directories are included in the results.
   *
   * @param opts Optional filesystem operation settings to override default
   * values
   *
   */
  readonly getVolumeMountPoints = async (
    opts?: Partial<GetVolumeMountPointOptions>,
  ): Promise<MountPoint[]> => {
    const o = optionsWithDefaults(opts);
    return thenOrTimeout(getVolumeMountPoints(this.#nativeFn, o), {
      timeoutMs: o.timeoutMs,
      desc: "getVolumeMountPoints()",
    });
  };

  /**
   * Get metadata for the volume at the given mount point.
   *
   * @param mountPoint Must be a non-blank string
   * @param opts Optional filesystem operation settings.
   */
  readonly getVolumeMetadata = (
    mountPoint: string,
    opts?: Partial<Pick<Options, "timeoutMs">>,
  ): Promise<VolumeMetadata> => {
    const o = optionsWithDefaults(opts);
    return thenOrTimeout(getVolumeMetadata(mountPoint, this.#nativeFn, o), {
      timeoutMs: o.timeoutMs,
      desc: "getVolumeMetadata()",
    });
  };

  /**
   * Retrieves metadata for all mounted volumes with optional filtering and
   * concurrency control.
   *
   * @param opts - Optional configuration object
   * @param opts.includeSystemVolumes - If true, includes system volumes in the
   * results. Defaults to false.
   * @param opts.maxConcurrency - Maximum number of concurrent operations.
   * Defaults to the system's available parallelism: see
   * {@link https://nodejs.org/api/os.html#osavailableparallelism | os.availableParallelism()}
   * @param opts.timeoutMs - Maximum time to wait for each
   * {@link getVolumeMetadata} to complete. Defaults to
   * {@link TimeoutMsDefault}.
   * @returns Promise that resolves to an array of either VolumeMetadata objects
   * or error objects containing the mount point and error
   * @throws Never - errors are caught and returned as part of the result array
   */
  readonly getAllVolumeMetadata = async (
    opts?: Partial<Options> & {
      includeSystemVolumes?: boolean;
      maxConcurrency?: number;
      timeoutMs?: number;
    },
  ): Promise<(VolumeMetadata | { mountPoint: string; error: Error })[]> => {
    const arr = await this.getVolumeMountPoints(opts);
    return mapConcurrent({
      maxConcurrency: toGt0(opts?.maxConcurrency) ?? availableParallelism(),
      items:
        (opts?.includeSystemVolumes ?? false)
          ? arr
          : arr.filter((ea) => !ea.isSystemVolume),
      fn: async (mp) =>
        this.getVolumeMetadata(mp.mountPoint, opts).catch((error) => ({
          mountPoint: mp.mountPoint,
          error,
        })),
    }) as Promise<(VolumeMetadata | { mountPoint: string; error: Error })[]>;
  };

  /**
   * Check if a file or directory is hidden.
   *
   * Note that `path` may be _effectively_ hidden if any of the ancestor
   * directories are hidden: use {@link isHiddenRecursive} to check for this.
   *
   * @param pathname Path to file or directory
   * @returns Promise resolving to boolean indicating hidden state
   */
  readonly isHidden = (pathname: string): Promise<boolean> =>
    isHidden(pathname, this.#nativeFn);

  /**
   * Check if a file or directory is hidden, or if any of its ancestor
   * directories are hidden.
   */
  readonly isHiddenRecursive = (pathname: string): Promise<boolean> =>
    isHiddenRecursive(pathname, this.#nativeFn);

  readonly getHiddenMetadata = (pathname: string): Promise<HiddenMetadata> =>
    getHiddenMetadata(pathname, this.#nativeFn);

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
  readonly setHidden = (
    pathname: string,
    hidden: boolean,
    method: HideMethod = "auto",
  ) => setHidden(pathname, hidden, method, this.#nativeFn);
}
