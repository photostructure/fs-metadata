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
