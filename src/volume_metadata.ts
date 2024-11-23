// src/volume_metadata.ts

import { RemoteInfo } from "./remote_info.js";

/**
 * Metadata associated to a volume.
 */
export interface VolumeMetadata extends RemoteInfo {
  /**
   * Mount location (like "/home" or "C:\"). May be a unique key at any given
   * time, unless there are file system shenanigans (like from `mergefs`)
   */
  mountPoint: string;
  /**
   * The name of the mount. This may match the resolved mountPoint.
   */
  mountName?: string;
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
   * Device or service that the mountpoint is from. May be `/dev/sda1`,
   * `nfs-server:/export`, `//username@remoteHost/remoteShare`, or
   * `//cifs-server/share`
   */
  mountFrom: string;

  /**
   * UUID for the volume, like "d46edc85-a030-4dd7-a2a8-68344034e27d".
   */
  uuid?: string;
  /**
   * If there are non-critical errors while extracting metadata, those error
   * messages may be added to this field (say, from blkid or gio).
   *
   * Windows volumes may set this field to `Unknown`, `Unavailable`, `Healthy`,
   * `Disconnected`, `Error`, or `NoMedia`.
   */
  status?: string;
}
