// src/index.mts

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ExportsImpl } from "./exports.js";

// IMPORTANT: KEEP THESE IN SYNC WITH index.cts!
export {
  ExcludedFileSystemTypesDefault,
  ExcludedMountPointGlobsDefault,
  options,
  OptionsDefault,
  TimeoutMsDefault,
} from "./options.js";
export type { Options } from "./options.js";
export type { VolumeMetadata } from "./volume_metadata.js";

const impl = new ExportsImpl(dirname(fileURLToPath(import.meta.url)));

// I thought `export default impl` would work, but the types get lost 😢

export const getVolumeMountPoints = impl.getVolumeMountPoints;
export const getVolumeMetadata = impl.getVolumeMetadata;
export const getAllVolumeMetadata = impl.getAllVolumeMetadata;
