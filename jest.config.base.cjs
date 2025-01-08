// @ts-check

// jest.config.base.cjs

const { argv, platform } = require("node:process");

const otherPlatforms = ["linux", "darwin", "windows"]
  .filter((ea) => ea !== (platform === "win32" ? "windows" : platform))
  .map((ea) => `/${ea}/`);

/** @type {import('ts-jest').JestConfigWithTsJest} */
const baseConfig = {
  testEnvironment: "jest-environment-node",
  roots: ["<rootDir>/src"],
  coverageProvider: "v8",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  verbose: true,
  silent: false,
  randomize: true,
  setupFilesAfterEnv: [
    "jest-extended/all",
    "<rootDir>/src/test-utils/jest-matchers.ts",
  ],
  collectCoverage: !argv.includes("--no-coverage"),
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  collectCoverageFrom: [
    "src/**/*.ts",
    // We have to include dist/*js because there are integration tests that
    // import/require the root package directory:
    "dist/*js",
  ],
  coveragePathIgnorePatterns: [
    "exports",
    "setup",
    "/test-utils/",
    "\.d.ts$",
    "/types/",
    ...otherPlatforms,
  ],
  coverageThreshold: {
    // As of 20250106 on linux:
    // % Stmts | % Branch | % Funcs | % Lines
    //   93.63 |    87.05 |   91.86 |   93.63
    // As of 20250106 on darwin:
    // % Stmts | % Branch | % Funcs | % Lines
    //   85.91 |    84.03 |   88.69 |   85.91
    // As of 20250106 on windows:
    // % Stmts | % Branch | % Funcs | % Lines
    //   85.91 |    84.03 |   88.69 |   85.91
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
};

module.exports = baseConfig;
