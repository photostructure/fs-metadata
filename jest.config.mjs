import { env, platform } from "node:process";

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
  collectCoverage: platform === "linux" && !env.TEST_MEMORY,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  coveragePathIgnorePatterns: ["/__tests__/", "/test-utils/"],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  verbose: true,
  silent: false,
  randomize: true,
  setupFilesAfterEnv: ["jest-extended/all"],
};

export default config;
