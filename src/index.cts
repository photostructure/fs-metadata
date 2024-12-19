// src/index.cts

import { setup } from "./setup.js";

export * from "./exports.js";

export const {
  getVolumeMountPoints,
  getVolumeMetadata,
  getAllVolumeMetadata,
  isHidden,
  isHiddenRecursive,
  getHiddenMetadata,
  setHidden,
} = setup(__dirname);
