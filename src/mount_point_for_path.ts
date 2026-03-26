// src/mount_point_for_path.ts

import { realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { withTimeout } from "./async";
import { debug } from "./debuglog";
import { statAsync } from "./fs";
import { isMacOS } from "./platform";
import { isBlank, isNotBlank } from "./string";
import type { NativeBindingsFn } from "./types/native_bindings";
import type { Options } from "./types/options";
import { findMountPointByDeviceId } from "./volume_metadata";

export async function getMountPointForPathImpl(
  pathname: string,
  opts: Options,
  nativeFn: NativeBindingsFn,
): Promise<string> {
  if (isBlank(pathname)) {
    throw new TypeError("Invalid pathname: got " + JSON.stringify(pathname));
  }

  // realpath() resolves POSIX symlinks. APFS firmlinks are NOT resolved by
  // realpath(), but fstatfs() follows them — handled below on macOS.
  const resolved = await realpath(pathname);

  const resolvedStat = await statAsync(resolved);
  const dir = resolvedStat.isDirectory() ? resolved : dirname(resolved);

  if (isMacOS) {
    // Use the lightweight native getMountPoint which only does fstatfs —
    // no DiskArbitration, IOKit, or space calculations.
    const native = await nativeFn();
    if (native.getMountPoint) {
      debug("[getMountPointForPath] using native getMountPoint for %s", dir);
      const p = native.getMountPoint(dir);
      const mountPoint = await withTimeout({
        desc: "getMountPoint()",
        timeoutMs: opts.timeoutMs,
        promise: p,
      });
      if (isNotBlank(mountPoint)) {
        debug("[getMountPointForPath] resolved to %s", mountPoint);
        return mountPoint;
      }
    }
    // Fallback: should not happen on macOS, but defensive
    throw new Error("getMountPoint native function unavailable");
  }

  // Linux/Windows: device ID matching + path prefix tiebreaker
  debug("[getMountPointForPath] using device matching for %s", resolved);
  return findMountPointByDeviceId(resolved, resolvedStat, opts, nativeFn);
}
