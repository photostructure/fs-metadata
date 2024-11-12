// index.ts
import { stat } from "node:fs/promises";
import { thenOrTimeout } from "./async.js";
import { filterMountPoints, filterTypedMountPoints } from "./config_filters.js";
import { getLinuxMountPoints } from "./linux/mtab.js";
import { FsOptions, options } from "./options.js";
import { isLinux, isWindows } from "./platform.js";
import { blank } from "./string.js";
import { TypedMountPoint } from "./typed_mount_point.js";
import { extractUUID } from "./uuid.js";

export {
  ExcludedFileSystemTypesDefault,
  ExcludedMountPointGlobsDefault,
  options,
  TimeoutMsDefault,
} from "./options.js";
export type { FsOptions } from "./options.js";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const native = require("bindings")("node_fs_meta");

/**
 * Metadata associated to a volume.
 */
export interface VolumeMetadata {
  /**
   * Mount location (like "/home" or "C:\"). May be a unique key at any given
   * time, unless there are file system shenanigans (like from `mergefs`)
   */
  mountPoint: string;
  /**
   * This is the file system type (like "ext4" or "apfs")
   */
  fileSystem?: string;
  /**
   * The name of the partition
   */
  label?: string;
  /**
   * Total size in bytes
   */
  size: number;
  /**
   * Used size in bytes
   */
  used: number;
  /**
   * Available size in bytes
   */
  available: number;
  /**
   * Remote/network volume?
   */
  remote?: boolean;
  /**
   * If remote, the ip or hostname hosting the share (like "rusty" or "10.1.1.3")
   */
  remoteHost?: string;
  /**
   * If remote, the name of the share (like "homes")
   */
  remoteShare?: string;
  /**
   * UUID for the volume, like "d46edc85-a030-4dd7-a2a8-68344034e27d".
   */
  uuid?: string;
  /**
   * We may be able to tell if a mountpoint is "Connected and OK", "degraded",
   * "disconnected", or otherwise unknown.
   */
  ok?: boolean;
  /**
   * May be set if !ok
   */
  status?: string;
}

/**
 * List all active local and remote mount points on the system
 *
 * @param overrides Optional filesystem operation settings to override default values
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
  const arr = await native.getVolumeMountPoints();
  return filterMountPoints(arr, options);
}

async function getUnixMountPoints(options: FsOptions) {
  const arr = (await (isLinux
    ? getLinuxMountPoints()
    : native.getVolumeMountPoints())) as TypedMountPoint[];
  return (await filterTypedMountPoints(arr, options)).map(
    (ea) => ea.mountPoint,
  );
}

/**
 * Get metadata for the volume at the given mount point.
 *
 * @param mountPoint Must be a non-blank string
 * @param options Optional filesystem operation settings
 */
export async function getVolumeMetadata(
  mountPoint: string,
  overrides: Partial<FsOptions> = {},
): Promise<VolumeMetadata> {
  if (blank(mountPoint)) {
    throw new TypeError(
      "mountPoint is required: got " + JSON.stringify(mountPoint),
    );
  }
  return thenOrTimeout(_getVolumeMetadata(mountPoint), {
    timeoutMs: options(overrides).timeoutMs,
    desc: "getVolumeMetadata(" + mountPoint + ")",
  });
}

async function _getVolumeMetadata(mountPoint: string) {
  try {
    await stat(mountPoint);
  } catch (e) {
    throw new Error(`mountPoint ${mountPoint} is not accessible: ${e}`);
  }

  const result: VolumeMetadata = await native.getVolumeMetadata(mountPoint);
  result.uuid = extractUUID(result.uuid) ?? result.uuid;
  return result;
}
