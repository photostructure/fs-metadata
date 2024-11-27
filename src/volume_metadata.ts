// src/volume_metadata.ts

import { Stats } from "fs";
import { WrappedError } from "./error.js";
import { statAsync } from "./fs_promises.js";
import { getLabelFromDevDisk, getUuidFromDevDisk } from "./linux/dev_disk.js";
import { getLinuxMtabMetadata } from "./linux/mount_points.js";
import {
  MtabVolumeMetadata,
  mountEntryToPartialVolumeMetadata,
} from "./linux/mtab.js";
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

export async function getVolumeMetadata(
  mountPoint: string,
  o: GetVolumeMetadataOptions & Options,
  nativeFn: NativeBindingsFn,
): Promise<VolumeMetadata> {
  if (isBlank(mountPoint)) {
    throw new TypeError(
      "mountPoint is required: got " + JSON.stringify(mountPoint),
    );
  }

  mountPoint = normalizePath(mountPoint);

  if (o.onlyDirectories || isWindows) {
    let s: Stats;
    try {
      s = await statAsync(mountPoint);
    } catch (e) {
      throw new WrappedError(`mountPoint ${mountPoint} is not accessible`, e);
    }
    if (!s.isDirectory()) {
      throw new TypeError(`mountPoint ${mountPoint} is not a directory`);
    }
  }
  let remote: boolean = false;
  // Get filesystem info from mtab first on Linux
  let mtabInfo: undefined | MtabVolumeMetadata;
  let device: undefined | string;
  if (isLinux) {
    try {
      const m = await getLinuxMtabMetadata(mountPoint, o);
      mtabInfo = mountEntryToPartialVolumeMetadata(m);
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
    isRemoteFsType(metadata.fileSystem) ||
    (remoteInfo?.remote ?? metadata.remote ?? false);

  const result = compactValues({
    ...compactValues(mtabInfo),
    ...compactValues(remoteInfo),
    ...compactValues(metadata),
    mountPoint,
    remote,
  }) as unknown as VolumeMetadata;

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

  // Fix microsoft UUID format:
  result.uuid = extractUUID(result.uuid) ?? result.uuid ?? "";

  // Normalize remote share path
  if (isNotBlank(result.remoteShare)) {
    result.remoteShare = normalizePath(result.remoteShare);
  }

  return compactValues(result) as unknown as VolumeMetadata;
}
