// src/mount_point_for_path.ts

import { realpath } from "node:fs/promises";
import { validateTimeoutMs, withTimeout } from "./async";
import { debug } from "./debuglog";
import { toError } from "./error";
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
  if (isMacOS) {
    const native = await nativeFn();
    if (!native.getMountPoint) {
      throw new Error("getMountPoint native function unavailable");
    }
    // Native resolves symlinks and the containing directory off libuv too.
    // Doing realpath/stat here would reintroduce the process.exit hazard.
    const mountPoint = await native
      .getMountPoint(pathname, opts)
      .catch((error: unknown) => {
        throw toError(error);
      });
    if (isNotBlank(mountPoint)) return mountPoint;
    throw new Error("getMountPoint returned an empty mount point");
  }
  // Resolve symlinks before matching Linux/Windows device IDs and ancestors.
  const resolved = await resolvePath(pathname);

  const resolvedStat = await statAsync(resolved);

  // Linux/Windows: device ID filtering + longest ancestor path matching
  debug("[getMountPointForPath] using device matching for %s", resolved);
  return findMountPointByDeviceId(resolved, resolvedStat, opts, nativeFn);
}
