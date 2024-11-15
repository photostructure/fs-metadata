// src/typed_mount_point.ts

import { isBlank } from "./string.js";

export type TypedMountPoint = {
  mountPoint: string;
  fstype: string;
};

export function isTypedMountPoint(obj: any): obj is TypedMountPoint {
  return !isBlank(obj.mountPoint) && !isBlank(obj.fstype);
}
