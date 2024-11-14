// index.ts
import { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { thenOrTimeout } from "./async.js";
import { filterMountPoints, filterTypedMountPoints } from "./config_filters.js";
import { WrappedError } from "./error.js";
import { getLinuxMountPoints } from "./linux/mtab.js";
import { FsOptions, options, TimeoutMsDefault } from "./options.js";
import { isLinux, isWindows } from "./platform.js";
import { blank } from "./string.js";
import { extractUUID } from "./uuid.js";
import { VolumeMetadata } from "./volume_metadata.js";

export {
  ExcludedFileSystemTypesDefault,
  ExcludedMountPointGlobsDefault,
  options,
  TimeoutMsDefault,
} from "./options.js";
export type { FsOptions } from "./options.js";
export type { VolumeMetadata } from "./volume_metadata.js";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const native = require("bindings")("node_fs_meta");

/**
 * List all active local and remote mount points on the system.
 *
 * Only readable directories are included in the results.
 *
 * @param overrides Optional filesystem operation settings to override default
 * values
 *
 * @see {@link options} to help create a valid options object
 */
export async function getVolumeMountPoints(
  overrides: Partial<FsOptions> = {},
): Promise<string[]> {
  const o = options(overrides);

  return thenOrTimeout(
    isWindows ? getWindowsMountPoints(o) : getUnixMountPoints(o),
    { timeoutMs: o.timeoutMs, desc: "getVolumeMountPoints()" },
  );
}

async function getWindowsMountPoints(options: FsOptions) {
  const arr = await native.getVolumeMountPoints();
  return filterMountPoints(arr, options);
}

async function getUnixMountPoints(options: FsOptions) {
  return filterTypedMountPoints(
    await (isLinux ? getLinuxMountPoints() : native.getVolumeMountPoints()),
    options,
  );
}

/**
 * Get metadata for the volume at the given mount point.
 *
 * @param mountPoint Must be a non-blank string
 * @param options Optional filesystem operation settings. If not specified, the
 * timeoutMs will default to {@link TimeoutMsDefault}
 */
export async function getVolumeMetadata(
  mountPoint: string,
  opts: Partial<Pick<FsOptions, "timeoutMs" | "onlyDirectories">> = {},
): Promise<VolumeMetadata> {
  if (blank(mountPoint)) {
    throw new TypeError(
      "mountPoint is required: got " + JSON.stringify(mountPoint),
    );
  }
  const o = options(opts);
  return thenOrTimeout(_getVolumeMetadata(mountPoint, o), {
    timeoutMs: o.timeoutMs,
    desc: "getVolumeMetadata(" + mountPoint + ")",
  });
}

async function _getVolumeMetadata(
  mountPoint: string,
  opts: Pick<FsOptions, "onlyDirectories">,
): Promise<VolumeMetadata> {
  if (opts.onlyDirectories) {
    let s: Stats;
    try {
      s = await stat(mountPoint);
    } catch (e) {
      throw new WrappedError(`mountPoint ${mountPoint} is not accessible`, e);
    }
    if (!s.isDirectory()) {
      throw new TypeError(`mountPoint ${mountPoint} is not a directory`);
    }
  }
  const result: VolumeMetadata = await native.getVolumeMetadata(mountPoint);
  result.uuid = extractUUID(result.uuid) ?? result.uuid;
  return result;
}
