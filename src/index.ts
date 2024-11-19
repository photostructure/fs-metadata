// index.ts
import { Stats } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { thenOrTimeout } from "./async.js";
import { filterMountPoints, filterTypedMountPoints } from "./config_filters.js";
import { WrappedError } from "./error.js";
import { getLinuxMountPoints } from "./linux/mount_points.js";
import {
  isRemoteFSInfo,
  normalizeLinuxMountPoint,
  parseMtab,
} from "./linux/mtab.js";
import { GetVolumeMetadataOptions } from "./native_bindings.js";
import { native } from "./native_loader.js";
import { gt0 } from "./number.js";
import { FsOptions, options } from "./options.js";
import { isLinux, isWindows } from "./platform.js";
import { isBlank, isNotBlank } from "./string.js";
import { extractUUID } from "./uuid.js";
import { VolumeMetadata } from "./volume_metadata.js";

export {
  ExcludedFileSystemTypesDefault,
  ExcludedMountPointGlobsDefault,
  options,
  TimeoutMsDefault,
} from "./options.js";
export type { FsOptions } from "./options.js";
export type { VolumeMetadata } from "./volume_metadata.js";

/**
 * List all active local and remote mount points on the system.
 *
 * Only readable directories are included in the results.
 *
 * @param overrides Optional filesystem operation settings to override default
 * values
 *
 * @see {@link options} to help create a valid options object
 */
export async function getVolumeMountPoints(
  overrides: Partial<FsOptions> = {},
): Promise<string[]> {
  const o = options(overrides);

  return thenOrTimeout(
    isWindows ? getWindowsMountPoints(o) : getUnixMountPoints(o),
    { timeoutMs: o.timeoutMs, desc: "getVolumeMountPoints()" },
  );
}

async function getWindowsMountPoints(options: FsOptions) {
  const arr = await native().getVolumeMountPoints();
  return filterMountPoints(arr, options);
}

async function getUnixMountPoints(options: FsOptions) {
  return filterTypedMountPoints(
    await (isLinux ? getLinuxMountPoints() : native().getVolumeMountPoints()),
    options,
  );
}

/**
 * Get metadata for the volume at the given mount point.
 *
 * @param mountPoint Must be a non-blank string
 * @param options Optional filesystem operation settings. If not specified, the
 * timeoutMs will default to {@link TimeoutMsDefault}
 */
export async function getVolumeMetadata(
  mountPoint: string,
  opts: Partial<Pick<FsOptions, "timeoutMs" | "onlyDirectories">> = {},
): Promise<VolumeMetadata> {
  const o = options(opts);
  return thenOrTimeout(_getVolumeMetadata(mountPoint, o), {
    timeoutMs: o.timeoutMs,
    desc: "getVolumeMetadata()",
  });
}

async function _getVolumeMetadata(
  mountPoint: string,
  o: FsOptions,
): Promise<VolumeMetadata> {
  if (isBlank(mountPoint)) {
    throw new TypeError(
      "mountPoint is required: got " + JSON.stringify(mountPoint),
    );
  }

  if (o.onlyDirectories) {
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
      mountPoint = normalizeLinuxMountPoint(mountPoint);
      const mtab = await readFile(o.linuxMountTablePath, "utf8");
      const entries = parseMtab(mtab);
      const entry = entries.find((e) => e.fs_file === mountPoint);

      if (entry != null) {
        mtabInfo.fileSystem = entry.fs_vfstype;
        if (isRemoteFSInfo(entry)) {
          mtabInfo.remote = true;
          mtabInfo.remoteHost = entry.remoteHost;
          mtabInfo.remoteShare = entry.remoteShare;
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
  const metadata = (await native().getVolumeMetadata(
    mountPoint,
    nativeOptions,
  )) as VolumeMetadata;

  const result = { ...mtabInfo, ...metadata };
  result.uuid = extractUUID(result.uuid) ?? result.uuid;
  if (isNotBlank(result.remoteShare)) {
    // It's ok to do this on Windows too:
    result.remoteShare = normalizeLinuxMountPoint(result.remoteShare);
  }

  return result;
}
