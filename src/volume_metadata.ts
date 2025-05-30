// src/volume_metadata.ts

import { mapConcurrent, withTimeout } from "./async";
import { debug } from "./debuglog";
import { WrappedError } from "./error";
import { getLabelFromDevDisk, getUuidFromDevDisk } from "./linux/dev_disk";
import { getLinuxMtabMetadata } from "./linux/mount_points";
import {
  type MtabVolumeMetadata,
  mountEntryToPartialVolumeMetadata,
} from "./linux/mtab";
import { compactValues } from "./object";
import { IncludeSystemVolumesDefault, optionsWithDefaults } from "./options";
import { normalizePath } from "./path";
import { isLinux, isWindows } from "./platform";
import { extractRemoteInfo, isRemoteFsType } from "./remote_info";
import { isBlank, isNotBlank } from "./string";
import { assignSystemVolume } from "./system_volume";
import type {
  GetVolumeMetadataOptions,
  NativeBindingsFn,
} from "./types/native_bindings";
import type { Options } from "./types/options";
import type { VolumeMetadata } from "./types/volume_metadata";
import { parseUNCPath } from "./unc";
import { extractUUID } from "./uuid";
import { VolumeHealthStatuses, directoryStatus } from "./volume_health_status";
import { getVolumeMountPointsImpl } from "./volume_mount_points";

export async function getVolumeMetadataImpl(
  o: GetVolumeMetadataOptions & Options,
  nativeFn: NativeBindingsFn,
): Promise<VolumeMetadata> {
  if (isBlank(o.mountPoint)) {
    throw new TypeError(
      "Invalid mountPoint: got " + JSON.stringify(o.mountPoint),
    );
  }

  const p = _getVolumeMetadata(o, nativeFn);
  // we rely on the native bindings on Windows to do proper timeouts
  return isWindows
    ? p
    : withTimeout({
        desc: "getVolumeMetadata()",
        timeoutMs: o.timeoutMs,
        promise: p,
      });
}

async function _getVolumeMetadata(
  o: GetVolumeMetadataOptions & Options,
  nativeFn: NativeBindingsFn,
): Promise<VolumeMetadata> {
  o = optionsWithDefaults(o);
  const norm = normalizePath(o.mountPoint);
  if (norm == null) {
    throw new Error("Invalid mountPoint: " + JSON.stringify(o.mountPoint));
  }
  o.mountPoint = norm;

  debug(
    "[getVolumeMetadata] starting metadata collection for %s",
    o.mountPoint,
  );
  debug("[getVolumeMetadata] options: %o", o);

  const { status, error } = await directoryStatus(o.mountPoint, o.timeoutMs);
  if (status !== VolumeHealthStatuses.healthy) {
    debug("[getVolumeMetadata] directoryStatus error: %s", error);
    throw error ?? new Error("Volume not healthy: " + status);
  }

  debug("[getVolumeMetadata] readdir status: %s", status);

  let remote: boolean = false;
  // Get filesystem info from mtab first on Linux
  let mtabInfo: undefined | MtabVolumeMetadata;
  let device: undefined | string;
  if (isLinux) {
    debug("[getVolumeMetadata] collecting Linux mtab info");
    try {
      const m = await getLinuxMtabMetadata(o.mountPoint, o);
      mtabInfo = mountEntryToPartialVolumeMetadata(m, o);
      debug("[getVolumeMetadata] mtab info: %o", mtabInfo);
      if (mtabInfo.remote) {
        remote = true;
      }
      if (isNotBlank(m.fs_spec)) {
        device = m.fs_spec;
      }
    } catch (err) {
      debug("[getVolumeMetadata] failed to get mtab info: " + err);
      // this may be a GIO mount. Ignore the error and continue.
    }
  }

  if (isNotBlank(device)) {
    o.device = device;
    debug("[getVolumeMetadata] using device: %s", device);
  }

  debug("[getVolumeMetadata] requesting native metadata");
  const metadata = (await (
    await nativeFn()
  ).getVolumeMetadata(o)) as VolumeMetadata;
  debug("[getVolumeMetadata] native metadata: %o", metadata);

  // Some OS implementations leave it up to us to extract remote info:
  const remoteInfo =
    mtabInfo ??
    extractRemoteInfo(metadata.uri) ??
    extractRemoteInfo(metadata.mountFrom) ??
    (isWindows ? parseUNCPath(o.mountPoint) : undefined);

  debug("[getVolumeMetadata] extracted remote info: %o", remoteInfo);

  remote ||=
    isRemoteFsType(metadata.fstype) ||
    (remoteInfo?.remote ?? metadata.remote ?? false);

  debug("[getVolumeMetadata] assembling: %o", {
    status,
    mtabInfo,
    remoteInfo,
    metadata,
    mountPoint: o.mountPoint,
    remote,
  });
  const result = compactValues({
    status, // < let the implementation's status win by having this first
    ...compactValues(remoteInfo),
    ...compactValues(metadata),
    ...compactValues(mtabInfo),
    mountPoint: o.mountPoint,
    remote,
  }) as VolumeMetadata;

  // Backfill if blkid or gio failed us:
  if (isLinux && isNotBlank(device)) {
    // Sometimes blkid doesn't have the UUID in cache. Try to get it from
    // /dev/disk/by-uuid:
    result.uuid ??= (await getUuidFromDevDisk(device)) ?? "";
    result.label ??= (await getLabelFromDevDisk(device)) ?? "";
  }

  assignSystemVolume(result, o);

  // Fix microsoft's UUID format:
  result.uuid = extractUUID(result.uuid) ?? result.uuid ?? "";

  debug("[getVolumeMetadata] final result for %s: %o", o.mountPoint, result);
  return compactValues(result) as VolumeMetadata;
}

export async function getAllVolumeMetadataImpl(
  opts: Required<Options> & {
    includeSystemVolumes?: boolean;
    maxConcurrency?: number;
  },
  nativeFn: NativeBindingsFn,
): Promise<VolumeMetadata[]> {
  const o = optionsWithDefaults(opts);
  debug("[getAllVolumeMetadata] starting with options: %o", o);

  const arr = await getVolumeMountPointsImpl(o, nativeFn);
  debug("[getAllVolumeMetadata] found %d mount points", arr.length);

  const unhealthyMountPoints = arr
    .filter(
      (ea) => ea.status != null && ea.status !== VolumeHealthStatuses.healthy,
    )
    .map((ea) => ({
      mountPoint: ea.mountPoint,
      error: new WrappedError("volume not healthy: " + ea.status, {
        name: "Skipped",
      }),
    }));

  const includeSystemVolumes =
    opts?.includeSystemVolumes ?? IncludeSystemVolumesDefault;

  const systemMountPoints = includeSystemVolumes
    ? []
    : arr
        .filter((ea) => ea.isSystemVolume)
        .map((ea) => ({
          mountPoint: ea.mountPoint,
          error: new WrappedError("system volume", { name: "Skipped" }),
        }));

  const healthy = arr.filter(
    (ea) => ea.status == null || ea.status === VolumeHealthStatuses.healthy,
  );

  debug("[getAllVolumeMetadata] ", {
    allMountPoints: arr.map((ea) => ea.mountPoint),
    healthyMountPoints: healthy.map((ea) => ea.mountPoint),
  });

  debug(
    "[getAllVolumeMetadata] processing %d healthy volumes with max concurrency %d",
    healthy.length,
    o.maxConcurrency,
  );

  const results = await (mapConcurrent({
    maxConcurrency: o.maxConcurrency,
    items:
      (opts?.includeSystemVolumes ?? IncludeSystemVolumesDefault)
        ? healthy
        : healthy.filter((ea) => !ea.isSystemVolume),
    fn: async (mp) =>
      getVolumeMetadataImpl({ ...mp, ...o }, nativeFn).catch((error) => ({
        mountPoint: mp.mountPoint,
        error,
      })),
  }) as Promise<(VolumeMetadata | { mountPoint: string; error: Error })[]>);

  debug("[getAllVolumeMetadata] completed processing all volumes");
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
