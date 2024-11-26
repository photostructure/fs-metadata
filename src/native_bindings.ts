import type { Options } from "./options.js";
import type { TypedMountPoint } from "./typed_mount_point.js";
import type { VolumeMetadata } from "./volume_metadata.js";

export interface NativeBindings {
  /**
   * This is only available on macOS and Windows--Linux only hides files via
   * filename (if basename starts with a dot).
   */
  isHidden(path: string): Promise<boolean>;

  /**
   * This is only available on macOS and Windows--Linux only hides files via filename (if basename starts with a dot).
   *
   * @param path The path to the file or directory to hide or unhide
   * @param hidden If true, the file or directory will be hidden; if false, it will be unhidden
   * @throws {Error} If the operation fails
   */
  setHidden(path: string, hidden: boolean): Promise<void>;
  /**
   * This is only available on macOS and Windows--Linux directly reads from the
   * proc mounts table.
   */
  getVolumeMountPoints(): Promise<(string | TypedMountPoint)[]>;

  /**
   * This is only a partial implementation for most platforms, to minimize
   * native code when possible. The javascript side handles a bunch of
   * subsequent parsing and extraction logic.
   */
  getVolumeMetadata(
    mountPoint: string,
    options?: GetVolumeMetadataOptions & { device?: string },
  ): Promise<VolumeMetadata>;
  /**
   * This is only available on Linux, and only if libglib-2.0 is installed.
   */
  getGioMountPoints?(): Promise<TypedMountPoint[]>;
}

export type GetVolumeMetadataOptions = Partial<
  Pick<Options, "timeoutMs"> & {
    device: string;
  }
>;

export type NativeBindingsFn = () => NativeBindings | Promise<NativeBindings>;
