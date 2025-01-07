//@ts-check

import baseConfig from "./jest.config.base.cjs";

/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  ...baseConfig,
  displayName: "@photostructure/fs-metadata (ESM)",
  transform: {
    "^.+\\.(m)?ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.jest-esm.json",
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts", ".mts"],
};

export default config;
