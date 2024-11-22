// index.ts
import NodeGypBuild from "node-gyp-build";
import { Stats } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { thenOrTimeout } from "./async.js";
import { filterMountPoints, filterTypedMountPoints } from "./config_filters.js";
import { defer } from "./defer.js";
import { WrappedError } from "./error.js";
import { isRemoteFsType } from "./fs_type.js";
import { getLabelFromDevDisk, getUuidFromDevDisk } from "./linux/dev_disk.js";
import { getLinuxMountPoints } from "./linux/mount_points.js";
import { isRemoteFSInfo, parseFsSpec, parseMtab } from "./linux/mtab.js";
import { normalizeMountPoint } from "./mount_point.js";
import type {
  GetVolumeMetadataOptions,
  NativeBindings,
} from "./native_bindings.js";
import { gt0 } from "./number.js";
import { compactValues } from "./object.js";
import { type Options, options } from "./options.js";
import { isLinux, isWindows } from "./platform.js";
import { findAncestorDir } from "./stat.js";
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

  async #getUnixMountPoints(options: Options) {
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

    mountPoint = normalizeMountPoint(mountPoint);

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

    // Get filesystem info from mtab first on Linux
    const mtabInfo: Partial<VolumeMetadata> = {};

    let device: string | undefined;
    if (isLinux) {
      try {
        const mtab = await readFile(o.linuxMountTablePath, "utf8");
        const entries = parseMtab(mtab);
        const entry = entries.find((e) => e.fs_file === mountPoint);

        if (entry != null) {
          mtabInfo.mountFrom = device = entry.fs_spec;
          mtabInfo.fileSystem = entry.fs_vfstype;
          if (isRemoteFSInfo(entry)) {
            mtabInfo.remote = true;
            mtabInfo.remoteHost = entry.remoteHost;
            mtabInfo.remoteShare = entry.remoteShare;
            console.log("mtab found remote", { mountPoint, entry });
          }
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

    let remote = metadata.remote ?? false;

    // backstop for macOS:
    if (!remote && isRemoteFsType(metadata.fileSystem)) {
      remote = true;
    }

    // Some implementations leave it up to us to extract remote info:
    const remoteInfo =
      parseFsSpec(metadata.mountFrom) ??
      parseFsSpec(metadata.uri) ??
      (isWindows ? parseUNCPath(mountPoint) : undefined);
    const result = compactValues({
      ...mtabInfo,
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
        result.uuid = await getUuidFromDevDisk(device);
      }
      if (isBlank(result.label)) {
        result.label = await getLabelFromDevDisk(device);
      }
    }

    // Fix microsoft UUID format:
    result.uuid = extractUUID(result.uuid) ?? result.uuid;

    // Normalize remote share path
    if (isNotBlank(result.remoteShare)) {
      result.remoteShare = normalizeMountPoint(result.remoteShare);
    }

    return compactValues(result) as unknown as VolumeMetadata;
  }
}
