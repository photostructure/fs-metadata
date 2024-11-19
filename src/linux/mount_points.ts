// src/linux/mount_points.ts

import { readFile } from "node:fs/promises";
import { WrappedError } from "../error.js";
import { native } from "../native_loader.js";
import { FsOptions, options } from "../options.js";
import { toNotBlank } from "../string.js";
import { isTypedMountPoint, TypedMountPoint } from "../typed_mount_point.js";
import { parseMtab } from "./mtab.js";

export async function getLinuxMountPoints(
  opts?: Pick<FsOptions, "linuxMountTablePath">,
): Promise<TypedMountPoint[]> {
  // Get GIO mounts if available from native module
  const gioMounts: TypedMountPoint[] = [];
  try {
    const points = await native().getGioMountPoints?.();
    gioMounts.push(...points.filter(isTypedMountPoint));
  } catch (error) {
    console.warn(error);
    // GIO support not compiled in or failed, continue with just mtab mounts
  }

  const mtabMounts: TypedMountPoint[] = [];
  const input = options(opts).linuxMountTablePath;
  try {
    const mtabContent = await readFile(input, "utf8");
    for (const ea of parseMtab(mtabContent)) {
      const obj = {
        mountPoint: ea.fs_file,
        fstype: toNotBlank(ea.fs_vfstype) ?? toNotBlank(ea.fs_spec),
      };
      if (isTypedMountPoint(obj)) {
        mtabMounts.push(obj);
      }
    }
  } catch (error) {
    throw new WrappedError("Failed to read " + input, error);
  }

  return [...gioMounts, ...mtabMounts];
}
