// src/volume_metadata.ts

import { availableParallelism } from "node:os";
import { mapConcurrent, withTimeout } from "./async.js";
import { debug } from "./debuglog.js";
import { WrappedError } from "./error.js";
import { statAsync } from "./fs.js";
import { getLabelFromDevDisk, getUuidFromDevDisk } from "./linux/dev_disk.js";
import { getLinuxMtabMetadata } from "./linux/mount_points.js";
import {
  MtabVolumeMetadata,
  mountEntryToPartialVolumeMetadata,
} from "./linux/mtab.js";
import {
  MountPoint,
  getVolumeMountPoints,
  isSystemVolume,
} from "./mount_point.js";
import {
  GetVolumeMetadataOptions,
  NativeBindingsFn,
} from "./native_bindings.js";
import { toGt0 } from "./number.js";
import { compactValues } from "./object.js";
import {
  IncludeSystemVolumesDefault,
  Options,
  optionsWithDefaults,
} from "./options.js";
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
import { VolumeHealthStatuses } from "./volume_health_status.js";

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

  /**
   * If there are issues retrieving metadata, this will contain the error.
   */
  error?: Error;
}

export async function getVolumeMetadata(
  o: GetVolumeMetadataOptions & Options,
  nativeFn: NativeBindingsFn,
): Promise<VolumeMetadata> {
  if (isBlank(o.mountPoint)) {
    throw new TypeError(
      "Invalid mountPoint: got " + JSON.stringify(o.mountPoint),
    );
  }

  o.mountPoint = normalizePath(o.mountPoint);
  const p = _getVolumeMetadata(o, nativeFn);
  // we rely on the native bindings on Windows to do proper timeouts
  return isWindows
    ? p
    : withTimeout({ desc: "getVolumeMetadata", ...o, promise: p });
}

async function _getVolumeMetadata(
  o: GetVolumeMetadataOptions & Options,
  nativeFn: NativeBindingsFn,
): Promise<VolumeMetadata> {
  o = optionsWithDefaults(o);
  // This will throw an error if the mount point is not accessible:
  const s = await withTimeout({
    desc: "statAsync",
    promise: statAsync(o.mountPoint),
    timeoutMs: o.timeoutMs,
  }).catch((cause) => {
    throw new WrappedError(`mountPoint ${o.mountPoint} is not accessible`, {
      name: "IOError",
      cause,
      path: o.mountPoint,
    });
  });
  if (!s.isDirectory()) {
    throw new WrappedError(`mountPoint ${o.mountPoint} is not a directory`, {
      name: "IOError",
      code: "ENOTDIR",
      path: o.mountPoint,
    });
  }

  let remote: boolean = false;
  // Get filesystem info from mtab first on Linux
  let mtabInfo: undefined | MtabVolumeMetadata;
  let device: undefined | string;
  if (isLinux) {
    try {
      const m = await getLinuxMtabMetadata(o.mountPoint, o);
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

  if (isNotBlank(device)) {
    o.device = device;
  }
  const metadata = (await (
    await nativeFn()
  ).getVolumeMetadata(o)) as VolumeMetadata;

  // Some OS implementations leave it up to us to extract remote info:
  const remoteInfo =
    mtabInfo ??
    extractRemoteInfo(metadata.uri) ??
    extractRemoteInfo(metadata.mountFrom) ??
    (isWindows ? parseUNCPath(o.mountPoint) : undefined);

  remote ||=
    isRemoteFsType(metadata.fstype) ||
    (remoteInfo?.remote ?? metadata.remote ?? false);

  const result = compactValues({
    ...compactValues(mtabInfo),
    ...compactValues(remoteInfo),
    ...compactValues(metadata),
    mountPoint: o.mountPoint,
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

  // this is a backstop and should not override the value from native code
  // (which is going to be more accurate):
  result.isSystemVolume ??= isSystemVolume(o.mountPoint, result.fstype, o);

  // Fix microsoft's UUID format:
  result.uuid = extractUUID(result.uuid) ?? result.uuid ?? "";

  return compactValues(result) as VolumeMetadata;
}

export async function getAllVolumeMetadata(
  opts: Required<Options> & {
    includeSystemVolumes?: boolean;
    maxConcurrency?: number;
  },
  nativeFn: NativeBindingsFn,
): Promise<VolumeMetadata[]> {
  const o = optionsWithDefaults(opts);
  const arr = await getVolumeMountPoints(o, nativeFn);

  const unhealthyMountPoints = arr
    .filter(
      (ea) => ea.status != null && ea.status !== VolumeHealthStatuses.healthy,
    )
    .map((ea) => ({
      mountPoint: ea.mountPoint,
      error: new Error(ea.status),
    }));

  const includeSystemVolumes =
    opts?.includeSystemVolumes ?? IncludeSystemVolumesDefault;

  const systemMountPoints = includeSystemVolumes
    ? []
    : arr
        .filter((ea) => ea.isSystemVolume)
        .map((ea) => ({
          mountPoint: ea.mountPoint,
          error: new Error("system volume"),
        }));

  const healthy = arr.filter(
    (ea) => ea.status == null || ea.status === VolumeHealthStatuses.healthy,
  );

  debug("[getAllVolumeMetadata] ", {
    allMountPoints: arr.map((ea) => ea.mountPoint),
    healthyMountPoints: healthy.map((ea) => ea.mountPoint),
  });
  const maxConcurrency = toGt0(opts?.maxConcurrency) ?? availableParallelism();

  const results = await (mapConcurrent({
    maxConcurrency,
    items:
      (opts?.includeSystemVolumes ?? IncludeSystemVolumesDefault)
        ? healthy
        : healthy.filter((ea) => !ea.isSystemVolume),
    fn: async (mp) =>
      getVolumeMetadata({ ...mp, ...o }, nativeFn).catch((error) => ({
        mountPoint: mp.mountPoint,
        error,
      })),
  }) as Promise<(VolumeMetadata | { mountPoint: string; error: Error })[]>);

  return arr.map(
    (result) =>
      (results.find((ea) => ea.mountPoint === result.mountPoint) ??
        unhealthyMountPoints.find(
          (ea) => ea.mountPoint === result.mountPoint,
        ) ??
        systemMountPoints.find((ea) => ea.mountPoint === result.mountPoint) ?? {
          ...result,
          error: new WrappedError("Mount point metadata not retrieved", {
            name: "NotApplicableError",
          }),
        }) as VolumeMetadata,
  );
}
