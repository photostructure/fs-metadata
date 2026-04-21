// src/linux/mount_points.ts
import { readFile } from "node:fs/promises";
import { debug } from "../debuglog";
import { toError, WrappedError } from "../error";
import { optionsWithDefaults } from "../options";
import { type MountPoint } from "../types/mount_point";
import type { Options } from "../types/options";
import { MountEntry, mountEntryToMountPoint, parseMtab } from "./mtab";

export async function getLinuxMountPoints(
  opts?: Pick<Options, "linuxMountTablePaths">,
): Promise<MountPoint[]> {
  const o = optionsWithDefaults(opts);
  let cause: Error | undefined;
  for (const input of o.linuxMountTablePaths) {
    try {
      const mtabContent = await readFile(input, "utf8");
      const results = parseMtab(mtabContent)
        .map((ea) => mountEntryToMountPoint(ea))
        .filter((ea) => ea != null);
      debug("[getLinuxMountPoints] %s mount points: %o", input, results);
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      cause ??= toError(error);
    }
  }

  throw new WrappedError(
    `Failed to find any mount points (tried: ${JSON.stringify(o.linuxMountTablePaths)})`,
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
    `Failed to find mount point ${mountPoint} in an linuxMountTablePaths (tried: ${JSON.stringify(inputs)})`,
    caughtError,
  );
}
