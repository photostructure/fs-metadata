// src/hidden.ts

import { rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { debug } from "./debuglog";
import { WrappedError } from "./error";
import { statAsync } from "./fs";
import { isRootDirectory, normalizePath } from "./path";
import { isWindows } from "./platform";
import type { HiddenMetadata } from "./types/hidden_metadata";
import type { NativeBindingsFn } from "./types/native_bindings";

const HiddenSupportByPlatform: Partial<
  Record<NodeJS.Platform, Pick<HiddenMetadata, "supported">>
> = {
  win32: {
    supported: {
      dotPrefix: false,
      systemFlag: true,
    },
  },
  darwin: {
    supported: {
      dotPrefix: true,
      systemFlag: true,
    },
  },
  linux: {
    supported: {
      dotPrefix: true,
      systemFlag: false,
    },
  },
};

export const LocalSupport = HiddenSupportByPlatform[process.platform]
  ?.supported ?? {
  dotPrefix: false,
  systemFlag: false,
};

/**
 * Checks if the file or directory is hidden through any available method
 * @returns A boolean indicating if the item is hidden
 * @throws {Error} If the file doesn't exist or permissions are insufficient
 */
export async function isHiddenImpl(
  pathname: string,
  nativeFn: NativeBindingsFn,
): Promise<boolean> {
  debug("isHiddenImpl called with pathname: %s", pathname);
  const norm = normalizePath(pathname);
  if (norm == null) {
    throw new Error("Invalid pathname: " + JSON.stringify(pathname));
  }
  debug("Normalized path: %s", norm);
  debug(
    "LocalSupport: dotPrefix=%s, systemFlag=%s",
    LocalSupport.dotPrefix,
    LocalSupport.systemFlag,
  );

  const result =
    (LocalSupport.dotPrefix && isPosixHidden(norm)) ||
    (LocalSupport.systemFlag && (await isSystemHidden(norm, nativeFn)));

  debug("isHiddenImpl returning: %s", result);
  return result;
}

export async function isHiddenRecursiveImpl(
  path: string,
  nativeFn: NativeBindingsFn,
): Promise<boolean> {
  let norm = normalizePath(path);
  if (norm == null) {
    throw new Error("Invalid path: " + JSON.stringify(path));
  }
  while (!isRootDirectory(norm)) {
    if (await isHiddenImpl(norm, nativeFn)) {
      return true;
    }
    norm = dirname(norm);
  }
  return false;
}

export function createHiddenPosixPath(pathname: string, hidden: boolean) {
  const norm = normalizePath(pathname);
  if (norm == null) {
    throw new Error("Invalid pathname: " + JSON.stringify(pathname));
  }
  const dir = dirname(norm);
  const srcBase = basename(norm).replace(/^\./, "");
  const dest = join(dir, (hidden ? "." : "") + srcBase);
  return dest;
}

async function setHiddenPosix(
  pathname: string,
  hidden: boolean,
): Promise<string> {
  if (LocalSupport.dotPrefix) {
    const dest = createHiddenPosixPath(pathname, hidden);
    if (pathname !== dest) await rename(pathname, dest);
    return dest;
  }

  throw new Error("Unsupported platform");
}

function isPosixHidden(pathname: string): boolean {
  if (!LocalSupport.dotPrefix) return false;
  const b = basename(pathname);
  return b.startsWith(".") && b !== "." && b !== "..";
}

async function isSystemHidden(
  pathname: string,
  nativeFn: NativeBindingsFn,
): Promise<boolean> {
  debug("isSystemHidden called with pathname: %s", pathname);
  if (!LocalSupport.systemFlag) {
    debug("systemFlag not supported on this platform");
    // not supported on this platform
    return false;
  }

  // Let the native function handle all validation, including root directories
  // This ensures security checks are performed before any other checks
  const native = await nativeFn();
  debug("Calling native isHidden for: %s", pathname);

  try {
    const isHidden = await native.isHidden(pathname);
    debug("Native isHidden returned: %s", isHidden);
    return isHidden;
  } catch (error) {
    debug("Native isHidden threw error: %s", error);
    // Handle non-existent paths by returning false (consistent with Windows behavior)
    const errorStr = String(error);
    if (errorStr.includes("Path not found")) {
      debug("Path not found, returning false");
      return false;
    }
    throw error;
  }
}

/**
 * Gets detailed information about the hidden state of the file or directory
 * @returns An object containing detailed hidden state information
 * @throws {Error} If the file doesn't exist or permissions are insufficient
 */
export async function getHiddenMetadataImpl(
  pathname: string,
  nativeFn: NativeBindingsFn,
): Promise<HiddenMetadata> {
  const norm = normalizePath(pathname);
  if (norm == null) {
    throw new Error("Invalid pathname: " + JSON.stringify(pathname));
  }
  const dotPrefix = isPosixHidden(norm);
  const systemFlag = await isSystemHidden(norm, nativeFn);
  return {
    hidden: dotPrefix || systemFlag,
    dotPrefix,
    systemFlag,
    supported: LocalSupport,
  };
}

export type HideMethod = "dotPrefix" | "systemFlag" | "all" | "auto";

export type SetHiddenResult = {
  pathname: string;
  actions: {
    dotPrefix: boolean;
    systemFlag: boolean;
  };
};

export async function setHiddenImpl(
  pathname: string,
  hide: boolean,
  method: HideMethod,
  nativeFn: NativeBindingsFn,
): Promise<SetHiddenResult> {
  let norm = normalizePath(pathname);
  if (norm == null) {
    throw new Error("Invalid pathname: " + JSON.stringify(pathname));
  }

  if (method === "dotPrefix" && !LocalSupport.dotPrefix) {
    throw new Error("Dot prefix hiding is not supported on this platform");
  }

  if (method === "systemFlag" && !LocalSupport.systemFlag) {
    throw new Error("System flag hiding is not supported on this platform");
  }

  try {
    await statAsync(norm);
  } catch (cause) {
    throw new WrappedError("setHidden()", { cause });
  }

  if (isWindows && isRootDirectory(norm)) {
    throw new Error("Cannot hide root directory on Windows");
  }

  const actions = {
    dotPrefix: false,
    systemFlag: false,
  };

  let acted = false;

  if (LocalSupport.dotPrefix && ["auto", "all", "dotPrefix"].includes(method)) {
    if (isPosixHidden(norm) !== hide) {
      norm = await setHiddenPosix(norm, hide);
      actions.dotPrefix = true;
    }
    acted = true;
  }

  if (
    LocalSupport.systemFlag &&
    (["all", "systemFlag"].includes(method) || (!acted && method === "auto"))
  ) {
    await (await nativeFn()).setHidden(norm, hide);
    actions.systemFlag = true;
  }

  return { pathname: norm, actions };
}
