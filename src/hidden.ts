import { rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { canStatAsync } from "./fs_promises.js";
import { NativeBindingsFn } from "./native_bindings.js";
import { isRootDirectory, normalizePath } from "./path.js";
import { isWindows } from "./platform.js";

/**
 * Represents the detailed state of a file or directory's hidden attribute
 */
export interface HiddenMetadata {
  /**
   * Whether the item is considered hidden by any method
   */
  hidden: boolean;

  /**
   * Whether the item has a dot prefix (POSIX-style hidden). Windows doesn't
   * care about dot prefixes.
   */
  dotPrefix: boolean;

  /**
   * Whether the item has system hidden flags set, like via `chflags` on macOS
   * or on Windows via `GetFileAttributesW`
   */
  systemFlag: boolean;

  /**
   * Indicates which hiding methods are supported on the current platform
   */
  supported: {
    /**
     * Whether dot prefix hiding is supported on the current operating system
     */
    dotPrefix: boolean;

    /**
     * Whether system flag hiding is supported
     */
    systemFlag: boolean;
  };
}

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
export async function isHidden(
  pathname: string,
  nativeFn: NativeBindingsFn,
): Promise<boolean> {
  pathname = normalizePath(pathname);

  if (isWindows && isRootDirectory(pathname)) {
    // windows `attr` thinks all drive letters don't exist.
    return false;
  }

  // Windows doesn't hide dot-prefixed files or directories:
  return (
    (LocalSupport.dotPrefix && isPosixHidden(pathname)) ||
    (LocalSupport.systemFlag &&
      // don't bother the native bindings if the file doesn't exist:
      (await canStatAsync(pathname)) &&
      (await nativeFn()).isHidden(pathname))
  );
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

export function createHiddenPosixPath(pathname: string, hidden: boolean) {
  pathname = normalizePath(pathname);
  const dir = dirname(pathname);
  const srcBase = basename(pathname).replace(/^\./, "");
  const dest = join(dir, (hidden ? "." : "") + srcBase);
  return dest;
}

export async function setHiddenPosix(
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

export function isPosixHidden(pathname: string): boolean {
  const b = basename(pathname);
  return b.startsWith(".") && b !== "." && b !== "..";
}

/**
 * Gets detailed information about the hidden state of the file or directory
 * @returns An object containing detailed hidden state information
 * @throws {Error} If the file doesn't exist or permissions are insufficient
 */
export async function getHiddenMetadata(
  pathname: string,
  nativeFn: NativeBindingsFn,
): Promise<HiddenMetadata> {
  pathname = normalizePath(pathname);

  const dotPrefix = LocalSupport.dotPrefix && isPosixHidden(pathname);
  const systemFlag =
    LocalSupport.systemFlag && (await isHidden(pathname, nativeFn));
  return {
    hidden: dotPrefix || systemFlag,
    dotPrefix,
    systemFlag,
    supported: LocalSupport,
  };
}

export type HideMethod = "dotPrefix" | "systemFlag" | "all" | "auto";

export async function setHidden(
  pathname: string,
  hidden: boolean,
  method: HideMethod,
  nativeFn: NativeBindingsFn,
) {
  pathname = normalizePath(pathname);

  const actions = {
    dotPrefix: false,
    systemFlag: false,
  };

  let handled = false;

  if (LocalSupport.dotPrefix && ["auto", "all", "dotPrefix"].includes(method)) {
    if (isPosixHidden(pathname) !== hidden) {
      pathname = await setHiddenPosix(pathname, hidden);
      actions.dotPrefix = true;
    }
    handled = true;
  }

  if (
    LocalSupport.systemFlag &&
    (["all", "systemFlag"].includes(method) || (!handled && method === "auto"))
  ) {
    await (await nativeFn()).setHidden(pathname, hidden);
    actions.systemFlag = true;
  }

  return { pathname, actions };
}
