// src/types/native_bindings.ts

import { MountPoint } from "../mount_point.js";
import type { Options } from "../options.js";
import type { VolumeMetadata } from "../volume_metadata.js";

export interface NativeBindings {
  /**
   * Enable or disable debug logging. Set automatically if the `NODE_DEBUG`
   * environment matches `fs-meta`, `fs-metadata`, or
   * `photostructure:fs-metadata`.
   */
  setDebugLogging(enabled: boolean): void;

  /**
   * Sets a prefix for debug log messages. Defaults to the shortest enabled
   * debug log context, plus the process ID.
   */
  setDebugPrefix(prefix: string): void;

  /**
   * This is only available on macOS and Windows--Linux only hides files via
   * filename (if basename starts with a dot).
   */
  isHidden(path: string): Promise<boolean>;

  /**
   * This is only available on macOS and Windows--Linux only hides files via
   * filename (if basename starts with a dot).
   *
   * @param path The path to the file or directory to hide or unhide
   * @param hidden If true, the file or directory will be hidden; if false, it
   * will be unhidden
   * @throws {Error} If the operation fails
   */
  setHidden(path: string, hidden: boolean): Promise<void>;

  /**
   * This is only available on macOS and Windows--Linux directly reads from the
   * proc mounts table.
   */
  getVolumeMountPoints(
    options?: Pick<Options, "timeoutMs">,
  ): Promise<MountPoint[]>;

  /**
   * This is only available on Linux, and only if libglib-2.0 is installed.
   */
  getGioMountPoints?(): Promise<MountPoint[]>;

  /**
   * This is only a partial implementation for most platforms, to minimize
   * native code when possible. The javascript side handles a bunch of
   * subsequent parsing and extraction logic.
   */
  getVolumeMetadata(options: GetVolumeMetadataOptions): Promise<VolumeMetadata>;
}

export type GetVolumeMetadataOptions = {
  mountPoint: string;
  device?: string;
} & Partial<Pick<Options, "timeoutMs">>;

export type NativeBindingsFn = () => NativeBindings | Promise<NativeBindings>;
