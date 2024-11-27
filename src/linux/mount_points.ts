// src/linux/mount_points.ts

import { readFile } from "node:fs/promises";
import { toError, WrappedError } from "../error.js";
import type { NativeBindingsFn } from "../native_bindings.js";
import { type Options, optionsWithDefaults } from "../options.js";
import { toNotBlank } from "../string.js";
import {
  isTypedMountPoint,
  type TypedMountPoint,
} from "../typed_mount_point.js";
import { MountEntry, parseMtab } from "./mtab.js";

export async function getLinuxMountPoints(
  native: NativeBindingsFn,
  opts?: Pick<Options, "linuxMountTablePaths">,
): Promise<TypedMountPoint[]> {
  // Get GIO mounts if available from native module
  const gioMounts: TypedMountPoint[] = [];
  try {
    const points = await (await native()).getGioMountPoints?.();
    gioMounts.push(...(points ?? []).filter(isTypedMountPoint));
  } catch (error) {
    console.warn(error);
    // GIO support not compiled in or failed, continue with just mtab mounts
  }

  let caughtError: Error | undefined;
  const inputs = optionsWithDefaults(opts).linuxMountTablePaths;
  for (const input of inputs) {
    try {
      const mtabMounts: TypedMountPoint[] = [];
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
      return [...gioMounts, ...mtabMounts];
    } catch (error) {
      caughtError ??= toError(error);
    }
  }

  throw new WrappedError(
    `Failed to read any mount points (tried: ${JSON.stringify(inputs)})`,
    caughtError,
  );
}

export async function getLinuxMtabMetadata(
  mountPoint: string,
  opts?: Pick<Options, "linuxMountTablePaths">,
): Promise<MountEntry> {
  let caughtError: Error | undefined;
  const inputs = optionsWithDefaults(opts).linuxMountTablePaths;
  for (const input of inputs) {
    try {
      const mtabContent = await readFile(input, "utf8");
      for (const ea of parseMtab(mtabContent)) {
        if (ea.fs_file === mountPoint) {
          return ea;
        }
      }
    } catch (error) {
      caughtError ??= toError(error);
    }
  }

  throw new WrappedError(
    `Failed to find mount point ${mountPoint}: (tried: ${JSON.stringify(inputs)})`,
    caughtError,
  );
}
