// index.ts
import { stat } from "node:fs/promises";
import { asyncFilter } from "./Array";
import { getConfig } from "./Config";
import { compileGlob } from "./Glob";
import { getLinuxMountPoints, TypedMountPoint } from "./linux/mtab";

export { DefaultConfig, getConfig, setConfig } from "./Config";
export type { Config } from "./Config";

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
   *
   * Note that (especially on macOS), there may be several applicable UUIDs for
   * a given volume: the partition UUID, file system UUID, and disk UUID. This
   * will be the "volume" UUID.
   *
   * This value is present for some local volumes, if the operating system
   * exposes it. This value is never present for network volumes.
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
 * @return true if `path` exists
 */
async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)) != null;
  } catch {
    return false;
  }
}

const isLinux = process.platform === "linux";
const isWindows = process.platform === "win32";

async function getUnixMountPoints(): Promise<string[]> {
  const arr = (await (isLinux
    ? getLinuxMountPoints()
    : native.getVolumeMountPoints())) as TypedMountPoint[];
  const config = getConfig();
  const excludedFsRE = compileGlob(config.excludedFileSystemTypes);
  const excludeRE = compileGlob(config.excludedMountPointGlobs);
  return arr
    .filter((mp) => {
      return !excludedFsRE.test(mp.fstype) && !excludeRE.test(mp.mountPoint);
    })
    .map((ea) => ea.mountPoint);
}

/**
 * List all active local and remote mount points on the system
 */
export async function getVolumeMountPoints(): Promise<string[]> {
  // TODO: add fs type filtering for windows
  const arr = isWindows
    ? await native.getVolumeMountPoints()
    : await getUnixMountPoints();
  return (await asyncFilter(arr, exists)).sort();
}

const uuidRegex = /[a-z0-9-]{10,}/i;

function extractUUID(uuid: string | undefined): string | undefined {
  return uuid?.match(uuidRegex)?.[0];
}

/**
 * Get metadata for the volume at the given mount point.
 *
 * @param mountPoint Must be a non-blank string
 */
export async function getVolumeMetadata(
  mountPoint: string,
): Promise<VolumeMetadata> {
  if (
    mountPoint == null ||
    typeof mountPoint !== "string" ||
    mountPoint.trim().length === 0
  ) {
    throw new TypeError("mountPoint is required");
  }

  try {
    await stat(mountPoint);
  } catch (e) {
    throw new Error(`mountPoint ${mountPoint} is not accessible: ${e}`);
  }

  const result = await native.getVolumeMetadata(mountPoint);
  result.uuid = extractUUID(result.uuid) ?? result.uuid;
  return result;
}
