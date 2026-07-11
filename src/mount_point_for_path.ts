// src/mount_point_for_path.ts

import { realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { validateTimeoutMs, withTimeout } from "./async";
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
  resolvePath: typeof realpath = realpath,
): Promise<string> {
  if (isBlank(pathname)) {
    throw new TypeError("Invalid pathname: got " + JSON.stringify(pathname));
  }

  // Validate up front: the Linux/Windows device-matching route (especially
  // with a caller-supplied opts.mountPoints) never reaches withTimeout(),
  // which would otherwise be the first place an invalid timeoutMs throws.
  validateTimeoutMs(opts.timeoutMs, "getMountPointForPath()");

  return withTimeout({
    desc: "getMountPointForPath()",
    timeoutMs: opts.timeoutMs,
    promise: _getMountPointForPath(pathname, opts, nativeFn, resolvePath),
  });
}

async function _getMountPointForPath(
  pathname: string,
  opts: Options,
  nativeFn: NativeBindingsFn,
  resolvePath: typeof realpath,
): Promise<string> {
  // realpath() resolves POSIX symlinks. APFS firmlinks are NOT resolved by
  // realpath(), but fstatfs() follows them — handled below on macOS.
  const resolved = await resolvePath(pathname);

  const resolvedStat = await statAsync(resolved);
  const dir = resolvedStat.isDirectory() ? resolved : dirname(resolved);

  if (isMacOS) {
    // Use the lightweight native getMountPoint which only does fstatfs —
    // no DiskArbitration, IOKit, or space calculations.
    const native = await nativeFn();
    if (native.getMountPoint) {
      debug("[getMountPointForPath] using native getMountPoint for %s", dir);
      // No withTimeout() here: getMountPointForPathImpl() already wraps this
      // whole function in one deadline that also covers realpath()/stat().
      const mountPoint = await native.getMountPoint(dir);
      if (isNotBlank(mountPoint)) {
        debug("[getMountPointForPath] resolved to %s", mountPoint);
        return mountPoint;
      }
    }
    // Fallback: should not happen on macOS, but defensive
    throw new Error("getMountPoint native function unavailable");
  }

  // Linux/Windows: device ID filtering + longest ancestor path matching
  debug("[getMountPointForPath] using device matching for %s", resolved);
  return findMountPointByDeviceId(resolved, resolvedStat, opts, nativeFn);
}
