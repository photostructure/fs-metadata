// src/types/mount_point.ts

import type { VolumeHealthStatus } from "../volume_health_status";

/**
 * A mount point is a location in the file system where a volume is mounted.
 *
 * @see https://en.wikipedia.org/wiki/Mount_(computing)
 */
export interface MountPoint {
  /**
   * Mount location (like "/" or "C:\").
   */
  mountPoint: string;

  /**
   * The type of file system on the volume, like `ext4`, `apfs`, or `ntfs`.
   *
   * Note: on Windows this may show as "ntfs" for remote filesystems, as that
   * is how the filesystem is presented to the OS.
   */
  fstype?: string;

  /**
   * On Windows, returns the health status of the volume.
   *
   * Note that this is only available on Windows, as both Linux and macOS  are
   * prohibitively expensive, requiring forking `fsck -N` or `diskutil
   * verifyVolume`.
   *
   * If there are non-critical errors while extracting metadata, those error
   * messages may be added to this field (say, from blkid or gio).
   *
   * @see {@link VolumeHealthStatuses} for values returned by Windows.
   */
  status?: VolumeHealthStatus | string;

  /**
   * Indicates if this volume is primarily for system use (e.g., swap, snap
   * loopbacks, EFI boot, or only system directories).
   *
   * Note: This is a best-effort classification and is not 100% accurate.
   *
   * @see {@link Options.systemPathPatterns} and {@link Options.systemFsTypes}
   */
  isSystemVolume?: boolean;

  /**
   * If there are non-critical errors while extracting metadata, those errors
   * may be added to this field.
   */
  error?: Error | string;
}
