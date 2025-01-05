// src/linux/mount_points.ts
import { readFile } from "node:fs/promises";
import { debug } from "../debuglog.js";
import { toError, WrappedError } from "../error.js";
import { compactValues } from "../object.js";
import { optionsWithDefaults } from "../options.js";
import { isMountPoint, type MountPoint } from "../types/mount_point.js";
import type { NativeBindingsFn } from "../types/native_bindings.js";
import type { Options } from "../types/options.js";
import { MountEntry, mountEntryToMountPoint, parseMtab } from "./mtab.js";

export async function getLinuxMountPoints(
  native: NativeBindingsFn,
  opts?: Pick<Options, "linuxMountTablePaths">,
): Promise<MountPoint[]> {
  const o = optionsWithDefaults(opts);
  const raw: MountPoint[] = [];
  try {
    // Get GIO mounts if available from native module
    const arr = await (await native()).getGioMountPoints?.();
    debug("[getLinuxMountPoints] GIO mount points: %o", arr);
    if (arr != null) raw.push(...arr);
  } catch (error) {
    debug("Failed to get GIO mount points: %s", error);
    // GIO support not compiled in or failed, continue with just mtab mounts
  }

  let cause: Error | undefined;
  for (const input of o.linuxMountTablePaths) {
    try {
      const mtabContent = await readFile(input, "utf8");
      const arr = parseMtab(mtabContent)
        .map((ea) => mountEntryToMountPoint(ea))
        .filter((ea) => ea != null);
      debug("[getLinuxMountPoints] %s mount points: %o", input, arr);
      if (arr.length > 0) {
        raw.push(...arr);
        break;
      }
    } catch (error) {
      cause ??= toError(error);
    }
  }

  const byMountPoint = new Map<string, MountPoint>();
  for (const ea of raw) {
    const prior = byMountPoint.get(ea.mountPoint);
    const merged = { ...compactValues(prior), ...compactValues(ea) };
    if (isMountPoint(merged)) {
      byMountPoint.set(merged.mountPoint, merged);
    }
  }

  if (byMountPoint.size === 0) {
    throw new WrappedError(
      `Failed to find any mount points (tried: ${JSON.stringify(o.linuxMountTablePaths)})`,
      { cause },
    );
  }

  const results = [...byMountPoint.values()];
  debug("[getLinuxMountPoints] %o", {
    results: results.map((ea) => ea.mountPoint),
  });

  return results;
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
    `Failed to find mount point ${mountPoint} in an linuxMountTablePaths (tried: ${JSON.stringify(inputs)})`,
    caughtError,
  );
}
