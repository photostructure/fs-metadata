// src/index.mts

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ExportsImpl } from "./exports.js";

// IMPORTANT: KEEP THESE IN SYNC WITH index.cts!
export {
  ExcludedFileSystemTypesDefault,
  ExcludedMountPointGlobsDefault,
  optionsWithDefaults as options,
  OptionsDefault,
  TimeoutMsDefault,
} from "./options.js";
export type { Options } from "./options.js";
export type { VolumeMetadata } from "./volume_metadata.js";

const impl = new ExportsImpl(dirname(fileURLToPath(import.meta.url)));

export const getVolumeMountPoints = impl.getVolumeMountPoints;
export const getVolumeMetadata = impl.getVolumeMetadata;
export const getAllVolumeMetadata = impl.getAllVolumeMetadata;
export const isHidden = impl.isHidden;
export const isHiddenRecursive = impl.isHiddenRecursive;
export const setHidden = impl.setHidden;
