import { FsOptions } from "./options.js";
import { TypedMountPoint } from "./typed_mount_point.js";
import { VolumeMetadata } from "./volume_metadata.js";

export interface NativeBindings {
  getVolumeMountPoints(): Promise<(string | TypedMountPoint)[]>;
  getVolumeMetadata(
    mountPoint: string,
    options?: GetVolumeMetadataOptions,
  ): Promise<VolumeMetadata>;
  getGioMountPoints?(): Promise<TypedMountPoint[]>;
}

export type GetVolumeMetadataOptions = Partial<
  Pick<FsOptions, "timeoutMs"> & {
    device: string;
  }
>;
