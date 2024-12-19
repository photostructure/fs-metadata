// src/exports.ts

import NodeGypBuild from "node-gyp-build";
import { debug, debugLogContext, isDebugEnabled } from "./debuglog.js";
import { defer } from "./defer.js";
import { ExportedFunctions } from "./exports.js";
import { findAncestorDir } from "./fs.js";
import {
  getHiddenMetadata,
  HideMethod,
  isHidden,
  isHiddenRecursive,
  setHidden,
} from "./hidden.js";
import {
  getVolumeMountPoints,
  type GetVolumeMountPointOptions,
} from "./mount_point.js";
import { optionsWithDefaults } from "./options.js";
import type { NativeBindings } from "./types/native_bindings.js";
import { getAllVolumeMetadata, getVolumeMetadata } from "./volume_metadata.js";

export function setup(dirname: string): ExportedFunctions {
  const nativeFn = defer<Promise<NativeBindings>>(async () => {
    const start = Date.now();
    try {
      const dir = await findAncestorDir(dirname, "binding.gyp");
      if (dir == null) {
        throw new Error(
          "Could not find bindings.gyp in any ancestor directory of " + dirname,
        );
      }
      const bindings = NodeGypBuild(dir) as NativeBindings;
      bindings.setDebugLogging(isDebugEnabled());
      bindings.setDebugPrefix(debugLogContext() + ":native");
      return bindings;
    } catch (error) {
      debug("Loading native bindings failed: %s", error);
      throw error;
    } finally {
      debug(`Native bindings took %d ms to load`, Date.now() - start);
    }
  });

  return {
    getVolumeMountPoints: (opts: Partial<GetVolumeMountPointOptions> = {}) =>
      getVolumeMountPoints(optionsWithDefaults(opts), nativeFn),

    getVolumeMetadata: (mountPoint: string, opts = {}) =>
      getVolumeMetadata({ ...optionsWithDefaults(opts), mountPoint }, nativeFn),

    getAllVolumeMetadata: (opts = {}) =>
      getAllVolumeMetadata(optionsWithDefaults(opts), nativeFn),

    isHidden: (pathname: string) => isHidden(pathname, nativeFn),

    isHiddenRecursive: (pathname: string) =>
      isHiddenRecursive(pathname, nativeFn),

    getHiddenMetadata: (pathname: string) =>
      getHiddenMetadata(pathname, nativeFn),

    setHidden: (
      pathname: string,
      hidden: boolean,
      method: HideMethod = "auto",
    ) => setHidden(pathname, hidden, method, nativeFn),
  } as const;
}
