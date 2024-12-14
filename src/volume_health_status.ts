// src/volume_health_status.ts

import { TimeoutError } from "./async.js";
import { debug } from "./debuglog.js";
import { canReaddir } from "./fs.js";
import { isObject } from "./object.js";
import { stringEnum, StringEnumKeys } from "./string_enum.js";

/**
 * Health statuses for volumes (mostly applicable to Windows).
 *
 * - `healthy`: Volume is "OK": accessible and functioning normally
 * - `timeout`: Volume could not be accessed before the specified timeout. It
 *   may be inaccessible or disconnected.
 * - `inaccessible`: Volume exists but can't be accessed (permissions/locks)
 * - `disconnected`: Network volume that's offline
 * - `unknown`: Status can't be determined
 */
export const VolumeHealthStatuses = stringEnum(
  "healthy",
  "timeout",
  "inaccessible",
  "disconnected",
  "unknown",
);

export type VolumeHealthStatus = StringEnumKeys<typeof VolumeHealthStatuses>;

/**
 * Attempt to read a directory to determine if it's accessible, and if an error
 * is thrown, convert to a health status.
 * @returns the "health status" of the directory, based on the success of `readdir(dir)`.
 * @throws never
 */
export async function directoryStatus(
  dir: string,
  timeoutMs: number,
  test: typeof canReaddir = canReaddir,
): Promise<VolumeHealthStatus> {
  try {
    if (await test(dir, timeoutMs)) {
      return VolumeHealthStatuses.healthy;
    }
  } catch (error) {
    debug("[directoryStatus] %s: %s", dir, error);
    if (error instanceof TimeoutError) {
      return VolumeHealthStatuses.timeout;
    }
    if (isObject(error) && "code" in error) {
      if (error.code === "EPERM" || error.code === "EACCES") {
        return VolumeHealthStatuses.inaccessible;
      }
    }
  }
  return VolumeHealthStatuses.unknown;
}
