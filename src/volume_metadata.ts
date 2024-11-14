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
