// index.ts
import NodeGypBuild from "node-gyp-build";
import { thenOrTimeout } from "./async.js";
import { filterMountPoints, filterTypedMountPoints } from "./config_filters.js";
import { defer } from "./defer.js";
import { findAncestorDir } from "./fs.js";
import { isHidden, isHiddenRecursive, setHidden } from "./hidden.js";
import { getLinuxMountPoints } from "./linux/mount_points.js";
import type { NativeBindings } from "./native_bindings.js";
import { type Options, optionsWithDefaults } from "./options.js";
import { isLinux, isWindows } from "./platform.js";
import { getVolumeMetadata, type VolumeMetadata } from "./volume_metadata.js";

/**
 * Glue code between the native bindings and the rest of the library to make
 * things simpler for index.ts and index.cts
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
   */
  readonly getVolumeMountPoints = async (
    opts: Partial<Options> = {},
  ): Promise<string[]> => {
    const o = optionsWithDefaults(opts);
    return thenOrTimeout(
      isWindows ? this.#getWindowsMountPoints(o) : this.#getUnixMountPoints(o),
      { timeoutMs: o.timeoutMs, desc: "getVolumeMountPoints()" },
    );
  };

  async #getWindowsMountPoints(options: Options) {
    const arr = await (await this.#nativeFn()).getVolumeMountPoints();
    return filterMountPoints(arr, options);
  }

  async #getUnixMountPoints(options: Options & { device?: string }) {
    return filterTypedMountPoints(
      await (isLinux
        ? getLinuxMountPoints(this.#nativeFn, options)
        : (await this.#nativeFn()).getVolumeMountPoints()),
      options,
    );
  }

  /**
   * Get metadata for the volume at the given mount point.
   *
   * @param mountPoint Must be a non-blank string
   * @param opts Optional filesystem operation settings.
   */
  readonly getVolumeMetadata = (
    mountPoint: string,
    opts: Partial<Pick<Options, "timeoutMs" | "onlyDirectories">> = {},
  ): Promise<VolumeMetadata> => {
    const o = optionsWithDefaults(opts);
    return thenOrTimeout(getVolumeMetadata(mountPoint, o, this.#nativeFn), {
      timeoutMs: o.timeoutMs,
      desc: "getVolumeMetadata()",
    });
  };

  /**
   * Get metadata for all volumes on the system.
   *
   * @param opts Optional filesystem operation settings to override default
   * values
   */
  readonly getAllVolumeMetadata = async (
    opts?: Partial<Options>,
  ): Promise<VolumeMetadata[]> => {
    const arr = await this.getVolumeMountPoints(opts);
    return Promise.all(arr.map((mp) => this.getVolumeMetadata(mp, opts)));
  };

  /**
   * Check if a file or directory is hidden.
   *
   * Note that `path` may be _effectively_ hidden if any of the ancestor
   * directories are hidden: use {@link isHiddenRecursive} to check for this.
   *
   * @param path Path to file or directory
   * @returns Promise resolving to boolean indicating hidden state
   */
  readonly isHidden = (path: string): Promise<boolean> =>
    isHidden(path, this.#nativeFn);

  /**
   * Check if a file or directory is hidden, or if any of its ancestor
   * directories are hidden.
   */
  readonly isHiddenRecursive = (path: string): Promise<boolean> =>
    isHiddenRecursive(path, this.#nativeFn);

  /**
   * Set the hidden state of a file or directory
   * @param path Path to file or directory
   * @param hidden Desired hidden state
   * @returns Promise resolving the final name of the file or directory (as it
   * will change on POSIX systems)
   */
  readonly setHidden = (path: string, hidden: boolean): Promise<string> =>
    setHidden(path, hidden, this.#nativeFn);
}
