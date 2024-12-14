//@ts-check

import { argv, platform } from "node:process";

const otherPlatforms = ["linux", "darwin", "windows"]
  .filter((ea) => ea !== (platform === "win32" ? "windows" : platform))
  .map((ea) => `/${ea}/`);

/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  displayName: "@photostructure/fs-metadata",
  testEnvironment: "jest-environment-node",
  roots: ["<rootDir>/src"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  // setupFiles: ["<rootDir>/.jest-setup.mjs"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.json",
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverage:
    argv.includes("--coverage") && !argv.includes("--no-coverage"),
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  coveragePathIgnorePatterns: [
    "debuglog",
    "\\.test\\.ts$",
    "/test-utils/",
    ...otherPlatforms,
  ],
  coverageThreshold: {
    // These are low because we're doing integration tests and there are quite
    // different codepaths for macOS, Windows, and Linux

    // As of 20241205, Windows (which is the lowest due to not testing the POSIX
    // codepaths) is at { stmts: 82, branch: 75, funcs: 87, lines: 82 } so this
    // gives us a little wiggle room

    global: {
      statements: 80,
      branches: 75,
      functions: 90,
      lines: 80,
    },
  },
  verbose: true,
  silent: false,
  randomize: true,
  setupFilesAfterEnv: ["jest-extended/all"],
};

export default config;
