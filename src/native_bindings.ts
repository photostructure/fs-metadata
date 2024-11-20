import type { Options } from "./options.js";
import type { TypedMountPoint } from "./typed_mount_point.js";
import type { VolumeMetadata } from "./volume_metadata.js";

export interface NativeBindings {
  getVolumeMountPoints(): Promise<(string | TypedMountPoint)[]>;
  getVolumeMetadata(
    mountPoint: string,
    options?: GetVolumeMetadataOptions,
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
