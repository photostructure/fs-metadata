import { isObject } from "./object";
import { isNotBlank } from "./string";
import { MountPoint } from "./types/mount_point";

export function isMountPoint(obj: unknown): obj is MountPoint {
  return isObject(obj) && "mountPoint" in obj && isNotBlank(obj.mountPoint);
}
