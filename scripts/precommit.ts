import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { platform } from "node:os";
import { exit } from "node:process";

const isLinux = platform() === "linux";
const isMacOS = platform() === "darwin";

function run({
  cmd,
  desc,
  exitOnFail: shouldExit = true,
}: {
  cmd: string;
  desc: string;
  exitOnFail?: boolean;
}) {
  console.log(`\n▶ ${desc ?? cmd}`);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch (error) {
    console.error(`✗ Failed: ${desc ?? cmd}: ` + error);
    if (shouldExit) exit(1);
  }
}

run({ cmd: "npm install", desc: "Installing dependencies" });
run({ cmd: "npm run update", desc: "Updating dependencies" });
rmSync("package-lock.json", { force: true });
run({ cmd: "npm install --ignore-scripts=false", desc: "Updating dependencies" });
run({ cmd: "npm run clean", desc: "Start fresh" });
run({ cmd: "npm run fmt", desc: "Formatting code" });
run({ cmd: "npm run lint", desc: "Running linting checks" });
run({ cmd: "npm run docs", desc: "TypeDoc generation" });
run({ cmd: "npm run build:dist", desc: "Building distribution files" });

// Detect if we're using glibc (vs musl)
// Check process.report for musl loader - if not found, assume glibc
const isGlibc = (() => {
  if (!isLinux) return false;
  const report = process.report?.getReport() as any;
  return !report?.sharedObjects?.some((lib: string) => /ld-musl/.test(lib));
})();

// Build native module with portable GLIBC
if (isLinux && isGlibc) {
  run({
    cmd: "npm run build:linux-glibc",
    desc: "Building native project with portable GLIBC",
  });
} else {
  // Clean old native builds to ensure fresh compilation
  run({ cmd: "npm run clean:native", desc: "Cleaning old native builds" });
  run({ cmd: "npm run build:native", desc: "Building native module" });
}

run({ cmd: "npm run tests", desc: "Running tests in ESM & CJS mode" });

// Platform-specific checks
if (isLinux || isMacOS) {
  // Remove stale compile_commands.json to ensure it's regenerated with current settings
  rmSync("compile_commands.json", { force: true });
  run({ cmd: "npm run lint:native", desc: "Running clang-tidy" });
}

// Run comprehensive memory tests (cross-platform)
// This includes Windows debug memory check on Windows
run({ cmd: "npm run check:memory", desc: "Comprehensive memory tests" });

console.log("\n✅ All precommit checks passed!");
