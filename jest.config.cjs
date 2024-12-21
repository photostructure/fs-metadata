// @ts-check

/** @type {import('ts-jest').JestConfigWithTsJest} */

const config = {
  displayName: "@photostructure/fs-metadata (CJS)",
  testEnvironment: "jest-environment-node",
  roots: ["<rootDir>/src"],
  coverageProvider: "v8",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.(c)?ts$": [
      "ts-jest",
      {
        useESM: false,
        tsconfig: "tsconfig.jest-cjs.json",
      },
    ],
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverage: false,
  verbose: true,
  silent: false,
  randomize: true,
  setupFilesAfterEnv: [
    "jest-extended/all",
    "<rootDir>/src/test-utils/jest-matchers.ts",
  ],
};

module.exports = config;
