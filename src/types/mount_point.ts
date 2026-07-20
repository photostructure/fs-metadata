// src/types/mount_point.ts

import type { VolumeHealthStatus } from "../volume_health_status";

/**
 * A mount point is a location in the file system where a volume is mounted.
 *
 * @see https://en.wikipedia.org/wiki/Mount_(computing)
 */
export interface MountPoint {
  /**
   * Mount location (like "/" or "C:\"). Explicit Linux path queries may
   * return a file path when that file is itself a bind-mount target. Public
   * volume enumeration omits detected non-directory targets; unprobed remote
   * targets are retained when `skipNetworkVolumes` is true.
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
   * messages may be added to this field (say, from blkid).
   *
   * @see {@link VolumeHealthStatuses} for values returned by Windows.
   */
  status?: VolumeHealthStatus | string;

  /**
   * Indicates if this volume is primarily for system use (e.g., swap, snap
   * loopbacks, EFI boot, or only system directories).
   *
   * On macOS, the sealed APFS system snapshot at `/` is detected natively via
   * `MNT_SNAPSHOT`; other infrastructure volumes under `/System/Volumes/*` are
   * detected via APFS volume roles (IOKit). Note that `/System/Volumes/Data`
   * is **not** a system volume — it holds all user data, accessed via firmlinks.
   *
   * @see {@link Options.systemPathPatterns} and {@link Options.systemFsTypes}
   */
  isSystemVolume?: boolean;

  /**
   * The APFS volume role, if available. Only present on macOS for APFS volumes.
   *
   * Common roles: `"System"`, `"Data"`, `"VM"`, `"Preboot"`, `"Recovery"`,
   * `"Update"`, `"Hardware"`, `"xART"`, `"Prelogin"`, `"Backup"`.
   *
   * Used for system volume detection: volumes with a non-`"Data"` role and
   * `MNT_DONTBROWSE` are classified as system volumes.
   *
   * @see https://eclecticlight.co/2024/11/21/how-do-apfs-volume-roles-work/
   */
  volumeRole?: string;

  /**
   * On btrfs, the subvolume path this mount exposes, taken verbatim from the
   * `subvol=` mount option (e.g. `/@` or `/@home`). Undefined on non-btrfs
   * volumes.
   *
   * Several mount points can be distinct subvolumes of one btrfs filesystem and
   * therefore share a single filesystem-level {@link VolumeMetadata.uuid}.
   * `subvol` and {@link subvolid} distinguish such siblings. Note that the
   * subvol path changes if the subvolume is renamed or moved; for a
   * rename-stable identifier prefer {@link VolumeMetadata.subvolumeUuid}.
   */
  subvol?: string;

  /**
   * On btrfs, the numeric subvolume id from the `subvolid=` mount option (e.g.
   * `256`, `257`). Undefined on non-btrfs volumes.
   *
   * Stable across remount/reboot on a given filesystem, but **not** unique
   * across filesystems and **not** preserved by `btrfs send`/`receive`. See
   * {@link subvol} for context and {@link VolumeMetadata.subvolumeUuid} for a
   * stronger identifier.
   */
  subvolid?: number;

  /**
   * Whether the volume is mounted read-only.
   *
   * Examples of read-only volumes include the macOS APFS system snapshot at
   * `/`, mounted ISO images, and write-protected media.
   *
   * Note that the macOS root volume (`/`) UUID changes on every OS update, so
   * consumers should avoid using it for persistent identification.
   */
  isReadOnly?: boolean;

  /**
   * If there are non-critical errors while extracting metadata, those errors
   * may be added to this field.
   */
  error?: Error | string;
}
