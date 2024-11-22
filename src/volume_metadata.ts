// src/volume_metadata.ts

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
  label?: string | undefined;
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
   * Remote/network volume?
   */
  remote?: boolean;
  /**
   * If remote, may include the username used to access the share.
   *
   * This will be undefined on NFS and other remote filesystem types that do
   * authentication out of band.
   */
  remoteUser?: string;
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
  uuid?: string | undefined;
  /**
   * May be set if !ok--either a message from an exception (say, from blkid or
   * gio), or a windows drive status, like `Unknown`, `Unavailable`, `Healthy`,
   * `Disconnected`, `Error`, or `NoMedia`
   */
  status?: string | undefined;
  /**
   * If remote, the full URI of the resource (like "smb://server/share")
   */
  uri?: string | undefined;
}
