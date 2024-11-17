// src/typed_mount_point.ts

import { isObject } from "./object.js";
import { isNotBlank } from "./string.js";

// matches src/linux/typed_mount_point.h

export type TypedMountPoint = {
  mountPoint: string;
  fstype: string;
};

export function isTypedMountPoint(obj: unknown): obj is TypedMountPoint {
  if (!isObject(obj)) return false;
  const { mountPoint, fstype } = obj as Partial<TypedMountPoint>;
  return isNotBlank(mountPoint) && isNotBlank(fstype);
}
