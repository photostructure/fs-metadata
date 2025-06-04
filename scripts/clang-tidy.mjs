#!/usr/bin/env node
import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import { platform } from "os";

// Skip clang-tidy on Windows
if (platform() === "win32") {
  console.log("Skipping clang-tidy on Windows platform");
  process.exit(0);
}

// Check for required tools
function checkCommand(command, installHint) {
  try {
    execSync(`which ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    console.error(`Error: '${command}' not found in PATH.`);
    console.error(`To install: ${installHint}`);
    return false;
  }
}

const isMacOS = platform() === "darwin";
const isLinux = platform() === "linux";

let hasAllTools = true;

if (
  !checkCommand(
    "bear",
    isLinux
      ? "sudo apt-get install bear"
      : isMacOS
        ? "brew install bear"
        : "see https://github.com/rizsotto/Bear",
  )
) {
  hasAllTools = false;
}

if (
  !checkCommand(
    "clang-tidy",
    isLinux
      ? "sudo apt-get install clang-tidy"
      : isMacOS
        ? "brew install llvm && alias clang-tidy=$(brew --prefix llvm)/bin/clang-tidy"
        : "see https://clang.llvm.org/extra/clang-tidy/",
  )
) {
  hasAllTools = false;
}

if (!hasAllTools) {
  process.exit(1);
}

// Generate compile_commands.json if needed
if (existsSync("build/compile_commands.json")) {
  console.log("Using existing compile_commands.json");
} else {
  console.log("Generating compile_commands.json...");

  try {
    execSync(
      "npm run configure:native && node-gyp configure -- -f gyp.generator.compile_commands_json.py",
      { stdio: "inherit" },
    );
  } catch (err) {
    console.log("Falling back to bear for compile_commands.json generation");
    execSync("npm run configure:native && bear -- npm run node-gyp-rebuild", {
      stdio: "inherit",
    });
  }
}

// Run clang-tidy on source files
const command = `find src -name '*.cpp' -o -name '*.h' | grep -E '\\.(cpp|h)$' | grep -v -E '(windows|darwin)/' | xargs clang-tidy -p build/`;

const shell = spawn("sh", ["-c", command], {
  stdio: "inherit",
  shell: false,
});

shell.on("exit", (code) => {
  process.exit(code || 0);
});

shell.on("error", (err) => {
  console.error("Failed to run clang-tidy:", err);
  process.exit(1);
});
