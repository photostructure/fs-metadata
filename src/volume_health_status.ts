// src/volume_health_status.ts

import { TimeoutError } from "./async";
import { debug } from "./debuglog";
import { toError } from "./error";
import { canReaddir } from "./fs";
import { isObject } from "./object";
import { stringEnum, StringEnumKeys } from "./string_enum";

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
  canReaddirImpl: typeof canReaddir = canReaddir,
): Promise<{ status: VolumeHealthStatus; error?: Error }> {
  try {
    if (await canReaddirImpl(dir, timeoutMs)) {
      return { status: VolumeHealthStatuses.healthy };
    }
  } catch (error) {
    debug("[directoryStatus] %s: %s", dir, error);
    let status: VolumeHealthStatus = VolumeHealthStatuses.unknown;
    if (error instanceof TimeoutError) {
      status = VolumeHealthStatuses.timeout;
    } else if (isObject(error) && error instanceof Error && "code" in error) {
      if (error.code === "EPERM" || error.code === "EACCES") {
        status = VolumeHealthStatuses.inaccessible;
      }
    }
    return { status, error: toError(error) };
  }
  return { status: VolumeHealthStatuses.unknown };
}
