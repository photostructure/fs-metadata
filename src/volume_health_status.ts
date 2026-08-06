// src/volume_health_status.ts

import { TimeoutError } from "./async";
import { debug } from "./debuglog";
import { toError } from "./error";
import { canReaddir } from "./fs";
import { isObject } from "./object";
import { stringEnum, StringEnumKeys } from "./string_enum";

/**
 * Accessibility statuses returned while enumerating volumes.
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
 * Divisor applied to the caller's whole-call `timeoutMs` to derive a single
 * mount point's health probe budget. See {@link healthProbeTimeoutMs}.
 */
export const HealthProbeTimeoutDivisor = 4;

/**
 * Per-mount-point budget for the {@link directoryStatus} probe issued while
 * enumerating volumes, carved out of the caller's whole-call `timeoutMs`.
 *
 * This must stay **strictly below** `timeoutMs`. Enumeration as a whole is also
 * bounded by `timeoutMs`, so a probe granted the full budget can never win that
 * race: the whole call rejects before any probe reports
 * {@link VolumeHealthStatuses.timeout}, and a single wedged mount point takes
 * every other volume down with it instead of being marked and skipped.
 *
 * A probe is one `readdir()`. A healthy volume answers in well under a
 * millisecond, so a quarter of the budget is generous even for a slow network
 * mount, and callers who need longer already have the right lever in
 * `timeoutMs`.
 *
 * @param timeoutMs the caller's whole-call budget; `0` disables timeouts
 * @returns `0` when timeouts are disabled, otherwise a positive budget. Values
 * of `timeoutMs` below 4 are degenerate (everything times out regardless) and
 * collapse to 1.
 */
export function healthProbeTimeoutMs(timeoutMs: number): number {
  // Normalize the way validateTimeoutMs() does before deciding anything: it
  // floors, so a sub-millisecond budget like 0.5 means "timeouts disabled".
  // Reading the raw value here would turn that into a 1ms probe that times out
  // every volume.
  const normalized = Math.floor(timeoutMs);
  if (normalized <= 0) return 0;
  // Never round down to zero: withTimeout() reads 0 as "no timeout", which
  // would silently restore the unbounded probe this function exists to prevent.
  return Math.max(1, Math.floor(normalized / HealthProbeTimeoutDivisor));
}

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
): Promise<{
  status: VolumeHealthStatus;
  error?: Error;
  isDirectory?: boolean;
}> {
  try {
    if (await canReaddirImpl(dir, timeoutMs)) {
      return { status: VolumeHealthStatuses.healthy, isDirectory: true };
    }
  } catch (error) {
    debug("[directoryStatus] %s: %s", dir, error);
    let status: VolumeHealthStatus = VolumeHealthStatuses.unknown;
    if (error instanceof TimeoutError) {
      status = VolumeHealthStatuses.timeout;
    } else if (isObject(error) && "code" in error) {
      if (error.code === "EPERM" || error.code === "EACCES") {
        status = VolumeHealthStatuses.inaccessible;
      }
    }
    const result = { status, error: toError(error) };
    return isObject(error) && "code" in error && error.code === "ENOTDIR"
      ? { ...result, isDirectory: false }
      : result;
  }
  return { status: VolumeHealthStatuses.unknown };
}
