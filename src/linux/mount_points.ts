// src/linux/mount_points.ts
import { readFile } from "node:fs/promises";
import { toError, WrappedError } from "../error.js";
import { isMountPoint, type MountPoint } from "../mount_point.js";
import type { NativeBindingsFn } from "../native_bindings.js";
import { optionsWithDefaults, type Options } from "../options.js";
import { MountEntry, mountEntryToMountPoint, parseMtab } from "./mtab.js";

export async function getLinuxMountPoints(
  native: NativeBindingsFn,
  opts?: Pick<Options, "linuxMountTablePaths">,
): Promise<MountPoint[]> {
  const o = optionsWithDefaults(opts);
  // Get GIO mounts if available from native module
  const gioMountPoints: MountPoint[] = [];
  try {
    const points = await (await native()).getGioMountPoints?.();
    if (points != null) gioMountPoints.push(...points);
  } catch (error) {
    console.warn("Failed to get GIO mount points: " + error);
    // GIO support not compiled in or failed, continue with just mtab mounts
  }

  let cause: Error | undefined;
  for (const input of o.linuxMountTablePaths) {
    try {
      const mtabContent = await readFile(input, "utf8");
      const mtabMounts = parseMtab(mtabContent)
        .map((ea) => mountEntryToMountPoint(ea, o))
        .filter((ea) => ea != null);
      if (mtabMounts.length > 0) {
        return [...gioMountPoints, ...mtabMounts].filter(isMountPoint);
      }
    } catch (error) {
      cause ??= toError(error);
    }
  }

  throw new WrappedError(
    `Failed to read any mount points (tried: ${JSON.stringify(o.linuxMountTablePaths)})`,
    { cause },
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
