#!/usr/bin/env tsx
import { exec as execCallback, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cpus, platform } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execCallback);

// Skip clang-tidy on Windows
if (platform() === "win32") {
  console.log("Skipping clang-tidy on Windows platform");
  process.exit(0);
}

// Colors for output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
} as const;

// Check for required tools
function checkCommand(command: string, installHint: string): boolean {
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
const compileCommandsPath = "compile_commands.json";
if (existsSync(compileCommandsPath)) {
  console.log("Using existing compile_commands.json");
} else {
  console.log("Generating compile_commands.json...");

  // Use bear to generate compile_commands.json
  // Bear intercepts the build commands and creates the compilation database
  execSync("npm run setup:native && bear -- npm run node-gyp-rebuild", {
    stdio: "inherit",
  });

  // Check if it was created successfully
  if (!existsSync(compileCommandsPath)) {
    console.error("Failed to generate compile_commands.json");
    console.error("Make sure bear is installed: sudo apt-get install bear");
    process.exit(1);
  }
}

// Find clang-tidy binary (try different versions)
function findClangTidy(): string {
  const versions = ["", "-18", "-17", "-16", "-15", "-14"];
  for (const version of versions) {
    try {
      execSync(`which clang-tidy${version}`, { stdio: "ignore" });
      return `clang-tidy${version}`;
    } catch {
      // Continue trying
    }
  }
  return "clang-tidy"; // fallback
}

// Get list of files to check
async function getSourceFiles(): Promise<string[]> {
  const { stdout } = await exec(
    `find src -name '*.cpp' -o -name '*.h' | grep -E '\\.(cpp|h)$' | grep -v -E '(windows|darwin)/'`,
  );
  return stdout
    .trim()
    .split("\n")
    .filter((f) => f);
}

interface TidyResult {
  file: string;
  output: string;
  errors: number;
  warnings: number;
}

// Run clang-tidy on a single file
async function runClangTidyOnFile(
  clangTidy: string,
  file: string,
): Promise<TidyResult> {
  try {
    const { stdout, stderr } = await exec(`${clangTidy} -p . "${file}" 2>&1`);
    const output = stdout + stderr;

    let errors = 0;
    let warnings = 0;
    const lines = output.split("\n");

    for (const line of lines) {
      if (line.includes(" warning:")) warnings++;
      if (line.includes(" error:")) errors++;
    }

    return { file, output, errors, warnings };
  } catch (error: any) {
    // clang-tidy returns non-zero on errors, capture output
    const output = error.stdout || error.stderr || error.message;
    let errors = 0;
    let warnings = 0;

    const lines = output.split("\n");
    for (const line of lines) {
      if (line.includes(" warning:")) warnings++;
      if (line.includes(" error:")) errors++;
    }

    return { file, output, errors, warnings };
  }
}

// Main function
async function main(): Promise<void> {
  const clangTidy = findClangTidy();
  console.log(`${colors.blue}=== Running clang-tidy ===${colors.reset}`);
  console.log(`${colors.dim}Using: ${clangTidy}${colors.reset}`);

  // Get files
  const files = await getSourceFiles();
  if (files.length === 0) {
    console.log(
      `${colors.yellow}No source files found to check${colors.reset}`,
    );
    return;
  }

  console.log(
    `${colors.dim}Checking ${files.length} files...${colors.reset}\n`,
  );

  // Run clang-tidy on files in parallel
  const parallelism = Math.min(cpus().length, 8);
  const results: TidyResult[] = [];

  // Process files in chunks
  for (let i = 0; i < files.length; i += parallelism) {
    const chunk = files.slice(i, i + parallelism);
    const chunkResults = await Promise.all(
      chunk.map((file) => runClangTidyOnFile(clangTidy, file)),
    );
    results.push(...chunkResults);

    // Show progress
    for (const result of chunkResults) {
      const relPath = result.file.replace(process.cwd() + "/", "");
      if (result.errors > 0) {
        console.log(
          `${colors.red}✗${colors.reset} ${relPath} (${result.errors} errors, ${result.warnings} warnings)`,
        );
        // Show actual errors
        const errorLines = result.output
          .split("\n")
          .filter(
            (line) => line.includes(" error:") || line.includes(" warning:"),
          );
        errorLines.forEach((line) =>
          console.log(`  ${colors.dim}${line}${colors.reset}`),
        );
      } else if (result.warnings > 0) {
        console.log(
          `${colors.yellow}⚠${colors.reset} ${relPath} (${result.warnings} warnings)`,
        );
      } else {
        console.log(`${colors.green}✓${colors.reset} ${relPath}`);
      }
    }
  }

  // Summary
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings, 0);

  console.log(`\n${colors.blue}=== Summary ===${colors.reset}`);
  if (totalErrors > 0) {
    console.log(`${colors.red}✗ ${totalErrors} errors found${colors.reset}`);
  }
  if (totalWarnings > 0) {
    console.log(
      `${colors.yellow}⚠ ${totalWarnings} warnings found${colors.reset}`,
    );
  }
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(`${colors.green}✓ No issues found${colors.reset}`);
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

// Run
main().catch((err) => {
  console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
  process.exit(1);
});
