/** Volume is "OK": accessible and functioning normally */
export const Healthy = "healthy" as const;

/** Volume exists but can't be accessed (permissions/locks) */
export const Inaccessible = "inaccessible" as const;

/** Network volume that's offline */
export const Disconnected = "disconnected" as const;

/** Volume has errors or performance issues */
export const Degraded = "degraded" as const;

/** Status can't be determined */
export const Unknown = "unknown" as const;

export type VolumeHealthStatus =
  | typeof Healthy
  | typeof Inaccessible
  | typeof Disconnected
  | typeof Degraded
  | typeof Unknown;

/**
 * A mount point is a location in the file system where a volume is mounted.
 */
export interface MountPoint {
  /**
   * The mount point for the volume.
   */
  pathname: string;

  /**
   * @see {@link VolumeHealthStatus}
   */
  status: VolumeHealthStatus;

  /**
   * The type of file system on the volume, like `ext4`, `apfs`, or `ntfs`.
   */
  fstype: string;

  /**
   * Indicates if this volume is primarily for system use (e.g., swap, snap
   * loopbacks, EFI boot, system directories).
   *
   * Note: This is a best-effort classification and is not 100% accurate.
   */
  isSystemVolume: boolean;
}
