// src/index.cts

import { ExportsImpl } from "./exports.js";

// IMPORTANT: KEEP THESE IN SYNC WITH index.ts!
export {
  ExcludedFileSystemTypesDefault,
  ExcludedMountPointGlobsDefault,
  options,
  Options,
  OptionsDefault,
  TimeoutMsDefault,
} from "./options.js";
export { VolumeMetadata } from "./volume_metadata.js";

const impl = new ExportsImpl(__dirname);

export const getVolumeMountPoints = impl.getVolumeMountPoints;
export const getVolumeMetadata = impl.getVolumeMetadata;