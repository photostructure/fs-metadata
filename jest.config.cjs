// @ts-check

const baseConfig = require("./jest.config.base.cjs");

/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  ...baseConfig,
  displayName: "@photostructure/fs-metadata (CJS)",
  transform: {
    "^.+\\.(c)?ts$": [
      "ts-jest",
      {
        useESM: false,
        tsconfig: "tsconfig.jest-cjs.json",
      },
    ],
  },
};

module.exports = config;
