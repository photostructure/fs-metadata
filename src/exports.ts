// index.ts
import NodeGypBuild from "node-gyp-build";
import { debug, debugLogContext, isDebugEnabled } from "./debuglog.js";
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
import { type Options, optionsWithDefaults } from "./options.js";
import type { NativeBindings } from "./types/native_bindings.js";
import {
  getAllVolumeMetadata,
  getVolumeMetadata,
  type VolumeMetadata,
} from "./volume_metadata.js";

/**
 * Glue code between the native bindings and the rest of the library to make
 * things simpler for index.ts and index.cts with the management of the native
 * bindings.
 */
export class ExportsImpl {
  constructor(readonly _dirname: string) {}

  readonly #nativeFn = defer<Promise<NativeBindings>>(async () => {
    const start = Date.now();
    try {
      const dir = await findAncestorDir(this._dirname, "binding.gyp");
      if (dir == null) {
        throw new Error(
          "Could not find bindings.gyp in any ancestor directory of " +
            this._dirname,
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
   * @param opts Optional filesystem operation settings to override default
   * values
   */
  readonly getVolumeMountPoints = (
    opts: Partial<GetVolumeMountPointOptions> = {},
  ): Promise<MountPoint[]> =>
    getVolumeMountPoints(optionsWithDefaults(opts), this.#nativeFn);

  /**
   * Get metadata for the volume at the given mount point.
   *
   * @param mountPoint Must be a non-blank string
   * @param opts Optional filesystem operation settings.
   */
  readonly getVolumeMetadata = (
    mountPoint: string,
    opts: Partial<Pick<Options, "timeoutMs">> = {},
  ): Promise<VolumeMetadata> =>
    getVolumeMetadata(
      { ...optionsWithDefaults(opts), mountPoint },
      this.#nativeFn,
    );

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
  readonly getAllVolumeMetadata = (
    opts?: Partial<Options> & {
      includeSystemVolumes?: boolean;
    },
  ) => getAllVolumeMetadata(optionsWithDefaults(opts), this.#nativeFn);

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
