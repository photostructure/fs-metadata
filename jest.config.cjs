// @ts-check

const { argv, platform } = require("node:process");

const otherPlatforms = ["linux", "darwin", "windows"]
  .filter((ea) => ea !== (platform === "win32" ? "windows" : platform))
  .map((ea) => `/${ea}/`);

const isESM =
  process.env.TEST_ESM === "1" ||
  process.env.NODE_OPTIONS?.includes("--experimental-vm-modules");

// Windows ARM64 CI detection
const isWindowsARM64CI = platform === "win32" && process.arch === "arm64" && process.env.CI;

if (isWindowsARM64CI) {
  console.log("[Jest Config] Windows ARM64 CI detected, applying workarounds:");
  console.log("  - maxWorkers: 1 (single worker mode)");
  console.log("  - workerIdleMemoryLimit: 1GB");
}

/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  displayName: `@photostructure/fs-metadata (${isESM ? "ESM" : "CJS"})`,
  testEnvironment: "jest-environment-node",
  // Workaround for Windows ARM64 Jest worker issues
  ...(isWindowsARM64CI && {
    maxWorkers: 1, // Force single worker to avoid worker thread issues
    workerIdleMemoryLimit: "1GB", // Increase memory limit
  }),
  roots: ["<rootDir>/src"],
  coverageProvider: "v8",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  verbose: true,
  silent: false,
  randomize: true,
  setupFilesAfterEnv: [
    "jest-extended/all",
    "<rootDir>/src/test-utils/jest-matchers.ts",
    "<rootDir>/src/test-utils/jest-setup.ts",
  ],
  collectCoverage: !argv.includes("--no-coverage"),
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.test.ts",
    "!src/**/*.test-*.ts",
  ],
  coveragePathIgnorePatterns: [
    "exports",
    "setup",
    "/test-utils/",
    "\\.d.ts$",
    "/types/",
    ...otherPlatforms,
  ],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 75,
      functions: 75,
      lines: 80,
    },
  },
  preset: isESM ? "ts-jest/presets/default-esm" : "ts-jest",
  extensionsToTreatAsEsm: isESM ? [".ts"] : [],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: isESM,
        tsconfig: {
          module: isESM ? "esnext" : "commonjs",
          target: "es2022",
          moduleResolution: "node",
          allowJs: true,
          esModuleInterop: true,
          resolveJsonModule: true,
          types: ["jest", "node"],
          lib: ["es2022"],
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },
  moduleNameMapper: isESM
    ? {
        "^(\\.{1,2}/.*)\\.js$": "$1",
      }
    : {},
};

module.exports = config;
