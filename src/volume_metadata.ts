// src/volume_metadata.ts

import { WrappedError } from "./error.js";
import { statAsync } from "./fs.js";
import { getLabelFromDevDisk, getUuidFromDevDisk } from "./linux/dev_disk.js";
import { getLinuxMtabMetadata } from "./linux/mount_points.js";
import {
  MtabVolumeMetadata,
  mountEntryToPartialVolumeMetadata,
} from "./linux/mtab.js";
import { MountPoint, isSystemVolume } from "./mount_point.js";
import {
  GetVolumeMetadataOptions,
  NativeBindingsFn,
} from "./native_bindings.js";
import { gt0 } from "./number.js";
import { compactValues } from "./object.js";
import { Options } from "./options.js";
import { normalizePath } from "./path.js";
import { isLinux, isWindows } from "./platform.js";
import {
  RemoteInfo,
  extractRemoteInfo,
  isRemoteFsType,
} from "./remote_info.js";
import { isBlank, isNotBlank } from "./string.js";
import { parseUNCPath } from "./unc.js";
import { extractUUID } from "./uuid.js";

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
   */
  uuid?: string;
}

export async function getVolumeMetadata(
  mountPoint: string,
  nativeFn: NativeBindingsFn,
  o: GetVolumeMetadataOptions & Options,
): Promise<VolumeMetadata> {
  if (isBlank(mountPoint)) {
    throw new TypeError(
      "Invalid mountPoint argument: got " + JSON.stringify(mountPoint),
    );
  }

  mountPoint = normalizePath(mountPoint);

  // This will throw an error if the mount point is not accessible:
  const s = await statAsync(mountPoint);
  if (!s.isDirectory()) {
    throw new WrappedError(`mountPoint ${mountPoint} is not a directory`, {
      code: "ENOTDIR",
      path: mountPoint,
    });
  }

  let remote: boolean = false;
  // Get filesystem info from mtab first on Linux
  let mtabInfo: undefined | MtabVolumeMetadata;
  let device: undefined | string;
  if (isLinux) {
    try {
      const m = await getLinuxMtabMetadata(mountPoint, o);
      mtabInfo = mountEntryToPartialVolumeMetadata(m, o);
      if (mtabInfo.remote) {
        remote = true;
      }
      if (isNotBlank(m.fs_spec)) {
        device = m.fs_spec;
      }
    } catch {
      // this may be a GIO mount. Ignore the error and continue.
    }
  }

  const nativeOptions: GetVolumeMetadataOptions = {};
  if (gt0(o.timeoutMs)) {
    nativeOptions.timeoutMs = o.timeoutMs;
  }
  if (isNotBlank(device)) {
    nativeOptions.device = device;
  }
  const metadata = (await (
    await nativeFn()
  ).getVolumeMetadata(mountPoint, nativeOptions)) as VolumeMetadata;

  // Some implementations leave it up to us to extract remote info:
  const remoteInfo =
    mtabInfo ??
    extractRemoteInfo(metadata.uri) ??
    extractRemoteInfo(metadata.mountFrom) ??
    (isWindows ? parseUNCPath(mountPoint) : undefined);

  remote ||=
    isRemoteFsType(metadata.fstype) ||
    (remoteInfo?.remote ?? metadata.remote ?? false);

  const result = compactValues({
    ...compactValues(mtabInfo),
    ...compactValues(remoteInfo),
    ...compactValues(metadata),
    mountPoint,
    remote,
  }) as VolumeMetadata;

  // Backfill if blkid or gio failed us:
  if (isLinux && isNotBlank(device)) {
    if (isBlank(result.uuid)) {
      // Sometimes blkid doesn't have the UUID in cache. Try to get it from
      // /dev/disk/by-uuid:
      result.uuid = (await getUuidFromDevDisk(device)) ?? "";
    }
    if (isBlank(result.label)) {
      result.label = (await getLabelFromDevDisk(device)) ?? "";
    }
  }

  result.isSystemVolume =
    result.isSystemVolume ?? isSystemVolume(mountPoint, result.fstype, o);

  // Fix microsoft UUID format:
  result.uuid = extractUUID(result.uuid) ?? result.uuid ?? "";

  // Normalize remote share path
  if (isNotBlank(result.remoteShare)) {
    result.remoteShare = normalizePath(result.remoteShare);
  }

  return compactValues(result) as VolumeMetadata;
}
