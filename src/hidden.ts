import { rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { statAsync } from "./fs_promises.js";
import { NativeBindingsFn } from "./native_bindings.js";
import { isRootDirectory, normalizePath } from "./path.js";
import { isLinux, isMacOS, isWindows } from "./platform.js";

export async function isHidden(
  path: string,
  nativeFn: NativeBindingsFn,
): Promise<boolean> {
  // Make sure the native code sees a normalized path:
  path = normalizePath(path);

  // Windows doesn't hide dot-prefixed files or directories:
  if (isLinux || isMacOS) {
    const b = basename(path);
    if (b.startsWith(".") && b !== "." && b !== "..") {
      return true;
    }
  }

  if (isWindows && isRootDirectory(path)) {
    // windows `attr` thinks all drive letters don't exist.
    return false;
  }

  // Don't bother the native code if the file doesn't exist.
  try {
    await statAsync(path);
  } catch {
    return false;
  }

  // only windows has a native implementation:
  if (isWindows) {
    return (await nativeFn()).isHidden(path);
  }

  return false;
}

export async function isHiddenRecursive(
  path: string,
  nativeFn: NativeBindingsFn,
): Promise<boolean> {
  let p = normalizePath(path);
  while (!isRootDirectory(p)) {
    if (await isHidden(p, nativeFn)) {
      return true;
    }
    p = dirname(p);
  }
  return false;
}

export async function setHidden(
  path: string,
  hidden: boolean,
  nativeFn: NativeBindingsFn,
): Promise<string> {
  if ((await isHidden(path, nativeFn)) === hidden) {
    return path;
  }

  if (isLinux || isMacOS) {
    const dir = dirname(path);
    const srcBase = basename(path).replace(/^\./, "");
    const dest = join(dir, (hidden ? "." : "") + srcBase);
    if (path !== dest) await rename(path, dest);
    return dest;
  }

  if (isWindows) {
    await (await nativeFn()).setHidden(path, hidden);
  }

  return path;
}
