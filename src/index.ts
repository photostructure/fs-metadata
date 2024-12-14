// src/index.mts

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ExportsImpl } from "./exports.js";

// IMPORTANT: KEEP THESE IN SYNC WITH index.cts!
export type { HiddenMetadata, HideMethod } from "./hidden.js";
export type { GetVolumeMountPointOptions, MountPoint } from "./mount_point.js";
export {
  IncludeSystemVolumesDefault,
  LinuxMountTablePathsDefault,
  optionsWithDefaults as options,
  OptionsDefault,
  SystemFsTypesDefault,
  SystemPathPatternsDefault,
  TimeoutMsDefault,
} from "./options.js";
export type { Options } from "./options.js";
export type {
  StringEnum,
  StringEnumKeys,
  StringEnumType,
} from "./string_enum.js";
export type { SystemVolumeConfig } from "./system_volume.js";
export { VolumeHealthStatuses } from "./volume_health_status.js";
export type { VolumeHealthStatus } from "./volume_health_status.js";
export type { VolumeMetadata } from "./volume_metadata.js";

const impl = new ExportsImpl(dirname(fileURLToPath(import.meta.url)));

export const getVolumeMountPoints = impl.getVolumeMountPoints;

export const getVolumeMetadata = impl.getVolumeMetadata;
export const getAllVolumeMetadata = impl.getAllVolumeMetadata;

export const isHidden = impl.isHidden;
export const isHiddenRecursive = impl.isHiddenRecursive;
export const getHiddenMetadata = impl.getHiddenMetadata;
export const setHidden = impl.setHidden;
