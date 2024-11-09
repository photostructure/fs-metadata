// index.ts
import { stat } from "node:fs/promises";
import { asyncFilter } from "./Array";
import { readMtab } from "./linux/mtab";

export { DefaultConfig, getConfig, setConfig } from "./Config";
export type { Config } from "./Config";

const native = require("bindings")("node_fs_meta");

export interface VolumeMetadata {
  /**
   * Mount location (like "/home" or "C:\"). May be a unique key at any given
   * time, unless there are filesystem shenanigans (like mergefs), but
   * **different volumes may be mounted to the same mountpoint**. See: macOS &
   * `/Volumes/Untitled 1`
   */
  mountpoint: string;
  /**
   * On posix systems, this is the name of the device. On Windows, this is the
   * filesystem type. Oops.
   */
  filesystem?: string;
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
   * The numeric identifier of the device containing the file
   */
  dev: number;
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
   * Sometimes present for local volumes.
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

/**
 * List all active local and remote mountpoints on the system
 */
export async function getMountpoints(): Promise<string[]> {
  const arr = isLinux ? readMtab() : native.getMountpoints();
  return asyncFilter(await arr, exists);
}

const uuidRegex = /[a-z0-9-]{10,}/i;

function extractUUID(uuid: string | undefined): string | undefined {
  return uuid?.match(uuidRegex)?.[0];
}

/**
 * Get metadata for a volume
 *
 * @param mountpoint The mountpoint to get metadata for. Must be a non-blank string.
 */
export async function getVolumeMetadata(
  mountpoint: string,
): Promise<VolumeMetadata> {
  if (
    mountpoint == null ||
    typeof mountpoint !== "string" ||
    mountpoint.trim().length === 0
  ) {
    throw new TypeError("Mountpoint is required");
  }

  try {
    await stat(mountpoint);
  } catch (e) {
    throw new Error(`Mountpoint ${mountpoint} is not accessible`);
  }

  const result = await native.getVolumeMetadata(mountpoint);
  result.uuid = extractUUID(result.uuid) ?? result.uuid;
  return result;
}
