// src/load-native.ts

import bindings from "bindings";
import { WrappedError } from "./error.js";
import { FsOptions } from "./options.js";
import { TypedMountPoint } from "./typed_mount_point.js";
import { VolumeMetadata } from "./volume_metadata.js";

export type GetVolumeMetadataOptions = Partial<
  Pick<FsOptions, "timeoutMs"> & {
    device: string;
  }
>;

export interface NativeBindings {
  getVolumeMountPoints(): Promise<(string | TypedMountPoint)[]>;
  getVolumeMetadata(
    mountPoint: string,
    options?: GetVolumeMetadataOptions,
  ): Promise<VolumeMetadata>;
  getGioMountPoints?(): Promise<TypedMountPoint[]>;
}

/**
 * Load the native bindings module
 */
function loadNativeBindings(): NativeBindings {
  try {
    return bindings("node_fs_meta");
  } catch (error) {
    throw new WrappedError("Failed to load native bindings", error);
  }
}

// Export a singleton instance
export const native = loadNativeBindings();
