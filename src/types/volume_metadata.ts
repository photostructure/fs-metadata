// src/types/volume_metadata.ts

import type { MountPoint } from "./mount_point";
import type { RemoteInfo } from "./remote_info";

/**
 * Metadata associated to a volume.
 *
 * @see https://en.wikipedia.org/wiki/Volume_(computing)
 */
export interface VolumeMetadata extends RemoteInfo, MountPoint {
  /**
   * The name of the partition
   */
  label?: string;
  /**
   * Total size in bytes
   */
  size?: number;
  /**
   * Used size in bytes
   */
  used?: number;
  /**
   * Available size in bytes
   */
  available?: number;

  /**
   * Path to the device or service that the mountpoint is from.
   *
   * Examples include `/dev/sda1`, `nfs-server:/export`,
   * `//username@remoteHost/remoteShare`, or `//cifs-server/share`.
   *
   * May be undefined for remote volumes.
   */
  mountFrom?: string;

  /**
   * The name of the mount. This may match the resolved mountPoint.
   */
  mountName?: string;

  /**
   * UUID for the volume, like "c9b08f6e-b392-11ef-bf19-4b13bb7db4b4".
   *
   * On windows, this _may_ be the 128-bit volume UUID, but if that is not
   * available, like in the case of remote volumes, we fallback to the 32-bit
   * volume serial number, rendered in lowercase hexadecimal.
   *
   * Note that on btrfs this is the **filesystem** UUID (keyed on the block
   * device by libblkid), so every subvolume of one filesystem reports the same
   * value. Use {@link subvolumeUuid} (and/or {@link MountPoint.subvolid}) to
   * distinguish sibling subvolumes.
   */
  uuid?: string;

  /**
   * On btrfs, the UUID of the individual subvolume mounted here, read from the
   * subvolume's root item via the `BTRFS_IOC_GET_SUBVOL_INFO` ioctl (kernel
   * >= 4.18, unprivileged). Rendered as a canonical lowercase hyphenated UUID.
   * Undefined on non-btrfs volumes, and on kernels/builds where the ioctl is
   * unavailable.
   *
   * Unlike {@link uuid} (the filesystem UUID, shared by all subvolumes) and
   * {@link MountPoint.subvolid} (stable only within one filesystem), this is
   * the strongest per-subvolume identifier:
   *
   * - stable across remount/reboot;
   * - `btrfs send`/`receive` preserves the source subvolume's UUID as the
   *   destination's `received_uuid` (the destination itself gets a fresh UUID);
   * - a snapshot gets a fresh UUID and records its origin as `parent_uuid`.
   *
   * This makes it suitable for persistent per-subvolume identity where the
   * filesystem {@link uuid} would collide across siblings.
   */
  subvolumeUuid?: string;

  /**
   * A stable filesystem identifier read from `statfs(2)`'s `f_fsid`, rendered as
   * a 16-character lowercase hex string.
   *
   * Currently populated on **ZFS**, where `f_fsid` is the dataset's persistent
   * *fsid GUID* — distinct per dataset and stable across remount, reboot, and
   * dataset rename (unlike {@link mountFrom}, which is the dataset name). ZFS
   * datasets otherwise report no {@link uuid} (libblkid cannot resolve a dataset
   * name to a block device), so this is a lightweight, dependency-free identity
   * source for them.
   *
   * Note: this is **not** the ZFS `guid` property shown by `zfs get guid` — it is
   * a separate, equally-stable per-dataset identifier available without libzfs or
   * a subprocess. Undefined on filesystems where `f_fsid` is not a reliable
   * stable identifier.
   */
  fsid?: string;
}
