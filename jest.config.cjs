// @ts-check

const { argv, platform } = require("node:process");

const otherPlatforms = ["linux", "darwin", "windows"]
  .filter((ea) => ea !== (platform === "win32" ? "windows" : platform))
  .map((ea) => `/${ea}/`);

const isESM =
  process.env.TEST_ESM === "1" ||
  process.env.NODE_OPTIONS?.includes("--experimental-vm-modules");

const nodeVersion = parseInt(process.version.slice(1).split(".")[0], 10);

const isNode24ESM = nodeVersion >= 24 && isESM;
const isWindowsCI = platform === "win32" && process.env.CI;

// Determine maxWorkers based on environment
let maxWorkers = undefined; // undefined means Jest uses default (number of cores - 1)
let workerIdleMemoryLimit = undefined; // undefined means Jest uses default

if (isWindowsCI) {
  console.log("[Jest Config] Windows CI detected, applying workarounds:");
  maxWorkers = 1;
  workerIdleMemoryLimit = "1GB";
} else if (isNode24ESM) {
  console.log(
    "[Jest Config] Node 24+ with ESM detected, applying workarounds:",
  );
  // Node 24 + ESM detection (avoid "module is already linked")
  maxWorkers = 1;
}

/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  displayName: `@photostructure/fs-metadata (${isESM ? "ESM" : "CJS"})`,
  testEnvironment: "jest-environment-node",
  ...(maxWorkers != null ? { maxWorkers } : {}),
  ...(workerIdleMemoryLimit != null ? { workerIdleMemoryLimit } : {}),
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
