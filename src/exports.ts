// index.ts
import NodeGypBuild from "node-gyp-build";
import { Stats } from "node:fs";
import { rename, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { thenOrTimeout } from "./async.js";
import { filterMountPoints, filterTypedMountPoints } from "./config_filters.js";
import { defer } from "./defer.js";
import { WrappedError } from "./error.js";
import { findAncestorDir } from "./fs.js";
import { getLabelFromDevDisk, getUuidFromDevDisk } from "./linux/dev_disk.js";
import {
  getLinuxMountPoints,
  getLinuxMtabMetadata,
} from "./linux/mount_points.js";
import type {
  GetVolumeMetadataOptions,
  NativeBindings,
} from "./native_bindings.js";
import { gt0 } from "./number.js";
import { compactValues } from "./object.js";
import { type Options, options } from "./options.js";
import { isRootDirectory, normalizePath } from "./path.js";
import { isLinux, isMacOS, isWindows } from "./platform.js";
import {
  extractRemoteInfo,
  isRemoteFsType,
  isRemoteInfo,
  RemoteInfo,
} from "./remote_info.js";
import { isBlank, isNotBlank } from "./string.js";
import { parseUNCPath } from "./unc.js";
import { extractUUID } from "./uuid.js";
import type { VolumeMetadata } from "./volume_metadata.js";

export {
  ExcludedFileSystemTypesDefault,
  ExcludedMountPointGlobsDefault,
  options,
  TimeoutMsDefault,
} from "./options.js";
export type { Options as FsOptions } from "./options.js";
export type { VolumeMetadata } from "./volume_metadata.js";

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
    const o = options(opts);

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
    const o = options(opts);
    return thenOrTimeout(this.#getVolumeMetadata(mountPoint, o), {
      timeoutMs: o.timeoutMs,
      desc: "getVolumeMetadata()",
    });
  };

  async #getVolumeMetadata(
    mountPoint: string,
    o: Options,
  ): Promise<VolumeMetadata> {
    if (isBlank(mountPoint)) {
      throw new TypeError(
        "mountPoint is required: got " + JSON.stringify(mountPoint),
      );
    }

    mountPoint = normalizePath(mountPoint);

    if (o.onlyDirectories || isWindows) {
      let s: Stats;
      try {
        s = await stat(mountPoint);
      } catch (e) {
        throw new WrappedError(`mountPoint ${mountPoint} is not accessible`, e);
      }
      if (!s.isDirectory()) {
        throw new TypeError(`mountPoint ${mountPoint} is not a directory`);
      }
    }
    let remote: boolean = false;

    // Get filesystem info from mtab first on Linux
    let mtabRemoteInfo: undefined | RemoteInfo = undefined;
    let device: undefined | string;
    if (isLinux) {
      try {
        const m = await getLinuxMtabMetadata(mountPoint, o);
        if (isRemoteInfo(m)) {
          remote = m.remote ?? false;
          mtabRemoteInfo = m;
        }
        if (isNotBlank(m.fs_spec)) {
          device = m.fs_spec;
        }
      } catch (error) {
        console.warn("Failed to read mount table:", error);
      }
    }

    const nativeOptions: GetVolumeMetadataOptions = {};
    if (gt0(o.timeoutMs)) {
      nativeOptions.timeoutMs = o.timeoutMs;
    }
    if (isNotBlank(device)) {
      nativeOptions.device = device;
    }
    const metadata = (await (
      await this.#nativeFn()
    ).getVolumeMetadata(mountPoint, nativeOptions)) as VolumeMetadata;

    // Some implementations leave it up to us to extract remote info:
    const remoteInfo =
      mtabRemoteInfo ??
      extractRemoteInfo(metadata.uri) ??
      extractRemoteInfo(metadata.mountFrom) ??
      (isWindows ? parseUNCPath(mountPoint) : undefined);

    remote ||=
      isRemoteFsType(metadata.fileSystem) ||
      (remoteInfo?.remote ?? metadata.remote ?? false);

    const result = compactValues({
      ...compactValues(mtabRemoteInfo),
      ...compactValues(remoteInfo),
      ...compactValues(metadata),
      mountPoint,
      remote,
    }) as unknown as VolumeMetadata;

    // Backfill if blkid or gio failed us:
    if (isLinux && isNotBlank(device)) {
      if (isBlank(result.uuid)) {
        // Sometimes blkid doesn't have the UUID in cache. Try to get it from
        // /dev/disk/by-uuid:
        result.uuid = (await getUuidFromDevDisk(device)) ?? "";
      }
      if (isBlank(result.label)) {
        result.label = (await getLabelFromDevDisk(device)) ?? "";
      }
    }

    // Fix microsoft UUID format:
    result.uuid = extractUUID(result.uuid) ?? result.uuid ?? "";

    // Normalize remote share path
    if (isNotBlank(result.remoteShare)) {
      result.remoteShare = normalizePath(result.remoteShare);
    }

    return compactValues(result) as unknown as VolumeMetadata;
  }

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
  readonly isHidden = async (path: string): Promise<boolean> => {
    if (isLinux || isMacOS) {
      if (basename(path).startsWith(".")) {
        return true;
      }
    }
    if (isWindows && isRootDirectory(path)) {
      // windows `attr` thinks all drive letters don't exist.
      return false;
    }
    if (isWindows || isMacOS) {
      return (await this.#nativeFn()).isHidden(path);
    }
    return false;
  };

  /**
   * Check if a file or directory is hidden, or if any of its ancestor
   * directories are hidden.
   */
  readonly isHiddenRecursive = async (path: string): Promise<boolean> => {
    let p = normalizePath(path);
    while (!isRootDirectory(p)) {
      if (await this.isHidden(p)) {
        return true;
      }
      p = dirname(p);
    }
    return false;
  };

  /**
   * Set the hidden state of a file or directory
   * @param path Path to file or directory
   * @param hidden Desired hidden state
   * @returns Promise resolving the final name of the file or directory (as it
   * will change on POSIX systems)
   */
  readonly setHidden = async (
    path: string,
    hidden: boolean,
  ): Promise<string> => {
    if ((await this.isHidden(path)) === hidden) {
      return path;
    }

    if (isLinux || isMacOS) {
      const dir = dirname(path);
      const srcBase = basename(path).replace(/^\./, "");
      const dest = join(dir, (hidden ? "." : "") + srcBase);
      if (path !== dest) await rename(path, dest);
      return dest;
    }
    if (isWindows) {
      await (await this.#nativeFn()).setHidden(path, hidden);
    }
    return path;
  };
}
