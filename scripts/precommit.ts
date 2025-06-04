import { familySync } from "detect-libc";
import { execSync } from "node:child_process";
import { platform } from "node:os";

const isLinux = platform() === "linux";
const isMacOS = platform() === "darwin";
const isGlibc = isLinux && familySync() === "glibc";

function run(command: string, description: string) {
  console.log(`\n▶ ${description ?? command}`);
  try {
    execSync(command, { stdio: "inherit" });
  } catch (error) {
    console.error(`✗ Failed: ${description ?? command}: ` + error);
    process.exit(1);
  }
}

// Always run these
run("npm run clean", "Start fresh");
run("npm run fmt", "Formatting code");
run("npm run lint", "Running linting checks");
run("npm run build:dist", "Building distribution files");

// Build native module with portable GLIBC
if (isLinux && isGlibc) {
  run(
    "npm run build:linux-glibc",
    "Building native project with portable GLIBC",
  );
} else {
  run("npm run build:native", "Building native module");
}

run("npm run tests", "Running tests in ESM & CJS mode");

// Platform-specific checks
if (isLinux || isMacOS) {
  run("npm run lint:native", "Running clang-tidy");
}

// Run comprehensive memory tests (cross-platform)
run("npm run check:memory", "Comprehensive memory tests");

console.log("\n✅ All precommit checks passed!");
