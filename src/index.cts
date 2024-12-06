// src/index.cts

import { ExportsImpl } from "./exports.js";

// IMPORTANT: KEEP THESE IN SYNC WITH index.ts!
export type { HiddenMetadata, HideMethod } from "./hidden.js";
export type { MountPoint, SystemVolumeConfig } from "./mount_point.js";
export {
  LinuxMountTablePathsDefault,
  optionsWithDefaults as options,
  OptionsDefault,
  SystemFsTypesDefault,
  SystemPathPatternsDefault,
  TimeoutMsDefault,
} from "./options.js";
export type { Options } from "./options.js";
export type { VolumeMetadata } from "./volume_metadata.js";

const impl = new ExportsImpl(__dirname);

export const getVolumeMountPoints = impl.getVolumeMountPoints;

export const getVolumeMetadata = impl.getVolumeMetadata;
export const getAllVolumeMetadata = impl.getAllVolumeMetadata;

export const isHidden = impl.isHidden;
export const isHiddenRecursive = impl.isHiddenRecursive;
export const getHiddenMetadata = impl.getHiddenMetadata;
export const setHidden = impl.setHidden;
