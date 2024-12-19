// src/index.mts

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
} = setup(dirname(fileURLToPath(import.meta.url)));
