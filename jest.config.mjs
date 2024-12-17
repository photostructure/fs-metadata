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
  coverageProvider: "v8",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
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
  collectCoverageFrom: ["src/**/*.ts"],
  coveragePathIgnorePatterns: [
    "debuglog",
    "\\.test\\.ts$",
    "/test-utils/",
    "/types/",
    ...otherPlatforms,
  ],
  coverageThreshold: {
    // These are low because we're doing integration tests and there are quite
    // different codepaths for macOS, Windows, and Linux

    // As of 20241205, Windows (which is the lowest due to not testing the POSIX
    // codepaths) is at { stmts: 82, branch: 75, funcs: 87, lines: 82 } so this
    // gives us a little wiggle room

    global: {
      statements: 90,
      branches: 80,
      functions: 90,
      lines: 90,
    },
  },
  verbose: true,
  silent: false,
  randomize: true,
  setupFilesAfterEnv: [
    "jest-extended/all",
    "<rootDir>/src/test-utils/jest-matchers.ts"
  ],
};

export default config;
