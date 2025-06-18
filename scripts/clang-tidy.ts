#!/usr/bin/env tsx
import { exec as execCallback, execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { cpus, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execCallback);

// Check for environment variable to skip
if (process.env.SKIP_CLANG_TIDY) {
  console.log("Skipping clang-tidy (SKIP_CLANG_TIDY is set)");
  process.exit(0);
}

// Platform detection
const isWindows = platform() === "win32";
const isMacOS = platform() === "darwin";
const isLinux = platform() === "linux";

// Colors for output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
} as const;

// Platform-specific warnings
if (isMacOS) {
  console.log(
    "Note: clang-tidy on macOS with Homebrew LLVM may report false positives",
  );
  console.log(
    "due to header path issues. Set SKIP_CLANG_TIDY=1 to skip this check.",
  );
}

// Check for required tools (non-Windows only)
function checkCommand(command: string, installHint: string): boolean {
  if (isWindows) return true; // Skip on Windows

  try {
    execSync(`which ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    console.error(`Error: '${command}' not found in PATH.`);
    console.error(`To install: ${installHint}`);
    return false;
  }
}

// Find clang-tidy binary
function findClangTidy(): string | null {
  if (isWindows) {
    // Windows-specific paths
    const windowsPaths = [
      "C:\\Program Files\\LLVM\\bin\\clang-tidy.exe",
      "C:\\Program Files (x86)\\LLVM\\bin\\clang-tidy.exe",
      // Visual Studio 2022
      "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Tools\\Llvm\\x64\\bin\\clang-tidy.exe",
      "C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\VC\\Tools\\Llvm\\x64\\bin\\clang-tidy.exe",
      "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Tools\\Llvm\\x64\\bin\\clang-tidy.exe",
      // Visual Studio 2019
      "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\VC\\Tools\\Llvm\\bin\\clang-tidy.exe",
      "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional\\VC\\Tools\\Llvm\\bin\\clang-tidy.exe",
      "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise\\VC\\Tools\\Llvm\\bin\\clang-tidy.exe",
    ];

    for (const path of windowsPaths) {
      if (existsSync(path)) {
        return path;
      }
    }

    // Try to find in PATH
    try {
      execSync("where clang-tidy", { stdio: "ignore" });
      return "clang-tidy";
    } catch {
      return null;
    }
  } else {
    // Unix-like systems
    const versions = ["", "-18", "-17", "-16", "-15", "-14"];
    for (const version of versions) {
      try {
        execSync(`which clang-tidy${version}`, { stdio: "ignore" });
        return `clang-tidy${version}`;
      } catch {
        // Continue trying
      }
    }

    // On macOS, check Homebrew locations
    if (isMacOS) {
      const brewPrefixes = ["/opt/homebrew", "/usr/local"];
      for (const prefix of brewPrefixes) {
        const paths = [
          `${prefix}/opt/clang-tidy/bin/clang-tidy`,
          `${prefix}/opt/llvm/bin/clang-tidy`,
        ];

        for (const path of paths) {
          if (existsSync(path)) {
            return path;
          }
        }

        // Try versioned LLVM formulas
        for (let v = 18; v >= 14; v--) {
          const versionedPath = `${prefix}/opt/llvm@${v}/bin/clang-tidy`;
          if (existsSync(versionedPath)) {
            return versionedPath;
          }
        }
      }
    }

    return "clang-tidy"; // fallback
  }
}

// Generate compile_commands.json for Windows
async function generateWindowsCompileCommands(): Promise<boolean> {
  console.log("Generating compile_commands.json for Windows...");

  try {
    execSync("npm run setup:native", { stdio: "inherit" });

    const nodeVersion = process.version.slice(1);

    // Try multiple possible locations for node-gyp headers
    const possibleNodeGypPaths = [
      `${process.env.USERPROFILE}\\.node-gyp\\${nodeVersion}`,
      `${process.env.LOCALAPPDATA}\\node-gyp\\Cache\\${nodeVersion}`,
      `${process.env.APPDATA}\\npm\\node_modules\\node-gyp\\cache\\${nodeVersion}`,
    ];

    let nodeGyp = "";
    for (const path of possibleNodeGypPaths) {
      if (existsSync(join(path, "include", "node", "node.h"))) {
        nodeGyp = path;
        console.log("Found Node.js headers at:", nodeGyp);
        break;
      }
    }

    // If not found, install them
    if (!nodeGyp) {
      console.log("Installing Node.js headers...");
      execSync("npx node-gyp install", { stdio: "inherit" });

      // Check again
      for (const path of possibleNodeGypPaths) {
        if (existsSync(join(path, "include", "node", "node.h"))) {
          nodeGyp = path;
          break;
        }
      }

      if (!nodeGyp) {
        // Fallback to default
        nodeGyp = `${process.env.USERPROFILE}\\.node-gyp\\${nodeVersion}`;
      }
    }

    // Get all Windows sources
    const windowsSources: string[] = [];
    if (existsSync(join("src", "windows"))) {
      const entries = require("fs").readdirSync(join("src", "windows"));
      for (const entry of entries) {
        if (entry.endsWith(".cpp") || entry.endsWith(".h")) {
          windowsSources.push(join("src", "windows", entry));
        }
      }
    }

    // Add binding.cpp
    const sources = [...windowsSources, "src/binding.cpp"];

    // Find MSVC include paths
    const msvcPaths = [
      "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Tools\\MSVC",
      "C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\VC\\Tools\\MSVC",
      "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Tools\\MSVC",
      "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Tools\\MSVC",
      "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\VC\\Tools\\MSVC",
    ];

    let msvcInclude = "";
    for (const basePath of msvcPaths) {
      if (existsSync(basePath)) {
        const versions = require("fs").readdirSync(basePath);
        if (versions.length > 0) {
          const version = versions.sort().reverse()[0];
          msvcInclude = join(basePath, version, "include");
          if (existsSync(msvcInclude)) {
            console.log("Found MSVC includes at:", msvcInclude);
            break;
          }
        }
      }
    }

    // Find Windows SDK paths
    const sdkBase = "C:\\Program Files (x86)\\Windows Kits\\10\\Include";
    let sdkVersion = "";
    if (existsSync(sdkBase)) {
      const versions = require("fs")
        .readdirSync(sdkBase)
        .filter((v) => v.match(/^\d+\.\d+\.\d+\.\d+$/))
        .sort()
        .reverse();
      if (versions.length > 0) {
        sdkVersion = versions[0];
        console.log("Found Windows SDK version:", sdkVersion);
      }
    }

    // Create compile commands with absolute paths
    const commands = sources.map((source: string) => ({
      directory: process.cwd(),
      file: source,
      command: [
        "clang++", // Use clang++ for clang-tidy compatibility
        "-c",
        source,
        `-I${process.cwd()}/src/windows`,
        `-I${process.cwd()}/node_modules/node-addon-api`,
        `-I${nodeGyp}/include/node`,
        msvcInclude ? `-I${msvcInclude}` : "",
        sdkVersion ? `-I${sdkBase}\\${sdkVersion}\\ucrt` : "",
        sdkVersion ? `-I${sdkBase}\\${sdkVersion}\\shared` : "",
        sdkVersion ? `-I${sdkBase}\\${sdkVersion}\\um` : "",
        sdkVersion ? `-I${sdkBase}\\${sdkVersion}\\winrt` : "",
        "-DWIN32",
        "-D_WINDOWS",
        "-D_WIN64",
        "-D_M_X64=1",
        "-D_AMD64_=1",
        "-DNAPI_VERSION=8",
        "-DNODE_ADDON_API_DISABLE_DEPRECATED",
        "-DBUILDING_NODE_EXTENSION",
        "-std=c++17",
        "-fms-compatibility",
        "-fms-extensions",
        "-Wno-microsoft-include",
      ]
        .filter((arg) => arg)
        .join(" "),
    }));

    writeFileSync("compile_commands.json", JSON.stringify(commands, null, 2));
    console.log(
      `Created compile_commands.json with ${commands.length} entries`,
    );
    return true;
  } catch (error) {
    console.error("Failed to generate compile_commands.json:", error);
    return false;
  }
}

// Generate compile_commands.json for Unix-like systems
async function generateUnixCompileCommands(): Promise<void> {
  console.log("Generating compile_commands.json...");

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
    process.exit(1);
  }

  execSync("npm run setup:native && bear -- npm run node-gyp-rebuild", {
    stdio: "inherit",
  });

  if (!existsSync("compile_commands.json")) {
    console.error("Failed to generate compile_commands.json");
    process.exit(1);
  }
}

// Get source files to check
async function getSourceFiles(): Promise<string[]> {
  if (isWindows) {
    // Windows-specific files
    const files: string[] = [];
    const windowsDir = join("src", "windows");

    if (existsSync(windowsDir)) {
      const entries = require("fs").readdirSync(windowsDir);
      for (const entry of entries) {
        if (entry.endsWith(".cpp") || entry.endsWith(".h")) {
          files.push(join(windowsDir, entry));
        }
      }
    }

    // Also include binding.cpp
    files.push(join("src", "binding.cpp"));
    return files;
  } else {
    // Platform-specific exclusions for Unix-like systems
    let excludePattern = "";
    if (isMacOS) {
      excludePattern = "| grep -v -E '(windows|linux)/'";
    } else if (isLinux) {
      excludePattern = "| grep -v -E '(windows|darwin)/'";
    } else {
      excludePattern = "| grep -v -E '(windows|darwin|linux)/'";
    }

    const { stdout } = await exec(
      `find src -name '*.cpp' -o -name '*.h' | grep -E '\\.(cpp|h)$' ${excludePattern}`,
    );
    return stdout
      .trim()
      .split("\n")
      .filter((f) => f);
  }
}

// Filter out known Windows header issues
function filterWindowsHeaderErrors(output: string): {
  filteredOutput: string;
  errors: number;
  warnings: number;
} {
  const lines = output.split("\n");
  const filteredLines: string[] = [];
  let errors = 0;
  let warnings = 0;
  let skipNextLine = false;
  let inSystemHeader = false;

  // Patterns for known header issues that we want to filter out
  const systemHeaderPatterns = [
    // System header paths - match the entire error line
    /C:\\Program Files.*:\d+:\d+: (error|warning):/,
    /C:\\Users\\.*\\AppData.*:\d+:\d+: (error|warning):/,
    /\.node-gyp.*:\d+:\d+: (error|warning):/,
    /Windows Kits.*:\d+:\d+: (error|warning):/,
  ];

  // Known system header error messages that appear in user files
  const systemHeaderErrors = [
    /no member named '\w+' in the global namespace/,
    /no member named '\w+' in namespace 'std'/,
    /no template named '\w+' in namespace 'std'/,
    /no template named 'pointer_traits'/,
    /unknown type name 'stream(pos|off)'/,
    /no type named 'string' in namespace 'std'/,
    /use of undeclared identifier '_Elem'/,
    /use of undeclared identifier 'tuple'/,
    /cannot initialize return object of type 'int' with an lvalue of type 'const char/,
    /expected ';' after expression/,
    /unknown type name 'namespace'/,
    /expected unqualified-id/,
    /no type named 'type' in/,
    /declaration of anonymous struct must be a definition/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (skipNextLine) {
      skipNextLine = false;
      continue;
    }

    // Check if this is a system header location
    let isSystemHeader = false;
    for (const pattern of systemHeaderPatterns) {
      if (pattern.test(line)) {
        isSystemHeader = true;
        inSystemHeader = true;
        break;
      }
    }

    // Check if this is a known system header error in a user file
    if (!isSystemHeader && line.includes(" error:")) {
      for (const pattern of systemHeaderErrors) {
        if (pattern.test(line)) {
          isSystemHeader = true;
          break;
        }
      }
    }

    // Reset inSystemHeader flag when we see a new file
    if (line.match(/^[^:]+\.(cpp|h|hpp):\d+:\d+: (error|warning):/)) {
      inSystemHeader = false;
      for (const pattern of systemHeaderPatterns) {
        if (pattern.test(line)) {
          inSystemHeader = true;
          break;
        }
      }
    }

    if (!isSystemHeader && !inSystemHeader) {
      // Only add non-header errors to output
      filteredLines.push(line);

      // Count errors and warnings
      if (line.includes(" error:")) {
        errors++;
      }
      if (line.includes(" warning:")) {
        warnings++;
      }
    }
  }

  return {
    filteredOutput: filteredLines.join("\n"),
    errors,
    warnings,
  };
}

// Run clang-tidy on a single file
async function runClangTidyOnFile(
  clangTidy: string,
  file: string,
): Promise<{
  file: string;
  output: string;
  errors: number;
  warnings: number;
}> {
  try {
    let extraArgs = "";

    // Platform-specific config and arguments
    if (isWindows) {
      // Always use src/windows/.clang-tidy for Windows
      const configPath = join("src", "windows", ".clang-tidy");
      if (existsSync(configPath)) {
        extraArgs = `--config-file=${configPath}`;
      }
    } else if (isMacOS && clangTidy.includes("/opt/")) {
      // macOS with Homebrew LLVM needs extra paths
      const sdkPath = execSync("xcrun --show-sdk-path", {
        encoding: "utf8",
      }).trim();

      extraArgs =
        `--extra-arg=-isysroot${sdkPath} ` +
        `--extra-arg=-isystem${sdkPath}/usr/include/c++/v1 ` +
        `--extra-arg=-isystem${sdkPath}/usr/include ` +
        `--extra-arg=-isystem${sdkPath}/System/Library/Frameworks`;
    }

    const { stdout, stderr } = await exec(
      `${isWindows ? `"${clangTidy}"` : clangTidy} -p . ${extraArgs} "${file}" 2>&1`,
    );
    let output = stdout + stderr;

    let errors = 0;
    let warnings = 0;

    // Filter Windows header errors
    if (isWindows) {
      const filtered = filterWindowsHeaderErrors(output);
      output = filtered.filteredOutput;
      errors = filtered.errors;
      warnings = filtered.warnings;
    } else {
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.includes(" warning:")) warnings++;
        if (line.includes(" error:")) errors++;
      }
    }

    return { file, output, errors, warnings };
  } catch (error: any) {
    let output = error.stdout || error.stderr || error.message;
    let errors = 0;
    let warnings = 0;

    // Filter Windows header errors
    if (isWindows) {
      const filtered = filterWindowsHeaderErrors(output);
      output = filtered.filteredOutput;
      errors = filtered.errors;
      warnings = filtered.warnings;
    } else {
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.includes(" warning:")) warnings++;
        if (line.includes(" error:")) errors++;
      }
    }

    return { file, output, errors, warnings };
  }
}

// Main function
async function main(): Promise<void> {
  const clangTidy = findClangTidy();

  if (!clangTidy) {
    console.error(`${colors.red}Error: clang-tidy not found${colors.reset}`);
    if (isWindows) {
      console.error("\nTo install clang-tidy on Windows:");
      console.error(
        "1. Install LLVM: https://github.com/llvm/llvm-project/releases",
      );
      console.error("2. Or install Visual Studio 2019/2022 with C++ tools");
    } else if (isMacOS) {
      console.error("\nTo install on macOS:");
      console.error("  Option 1: brew install clang-tidy");
      console.error("  Option 2: brew install llvm");
    } else {
      console.error("\nTo install on Linux:");
      console.error("  sudo apt-get install clang-tidy");
    }
    process.exit(1);
  }

  console.log(`${colors.blue}=== Running clang-tidy ===${colors.reset}`);
  console.log(`${colors.dim}Using: ${clangTidy}${colors.reset}`);
  console.log(`${colors.dim}Platform: ${platform()}${colors.reset}`);

  // Generate or check compile_commands.json
  if (!existsSync("compile_commands.json")) {
    if (isWindows) {
      if (!(await generateWindowsCompileCommands())) {
        process.exit(1);
      }
    } else {
      await generateUnixCompileCommands();
    }
  } else {
    console.log("Using existing compile_commands.json");
  }

  // Get files to check
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

  // Run clang-tidy on files
  const parallelism = isWindows ? 1 : Math.min(cpus().length, 8);
  const results: Array<{
    file: string;
    output: string;
    errors: number;
    warnings: number;
  }> = [];

  // Process files
  if (isWindows) {
    // Sequential on Windows to avoid issues
    for (const file of files) {
      const result = await runClangTidyOnFile(clangTidy, file);
      results.push(result);

      // Show progress
      const relPath = file.replace(
        process.cwd() + (isWindows ? "\\" : "/"),
        "",
      );
      if (result.errors > 0) {
        console.log(
          `${colors.red}✗${colors.reset} ${relPath} (${result.errors} errors, ${result.warnings} warnings)`,
        );
        // Show first few errors (already filtered on Windows)
        const errorLines = result.output
          .split("\n")
          .filter(
            (line) => line.includes(" error:") || line.includes(" warning:"),
          );
        errorLines
          .slice(0, 5)
          .forEach((line) =>
            console.log(`  ${colors.dim}${line}${colors.reset}`),
          );
        if (errorLines.length > 5) {
          console.log(
            `  ${colors.dim}... and ${errorLines.length - 5} more${colors.reset}`,
          );
        }
      } else if (result.warnings > 0) {
        console.log(
          `${colors.yellow}⚠${colors.reset} ${relPath} (${result.warnings} warnings)`,
        );
      } else {
        console.log(`${colors.green}✓${colors.reset} ${relPath}`);
      }
    }
  } else {
    // Parallel on Unix-like systems
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

  if (isWindows) {
    console.log(
      `\n${colors.dim}Windows: Using src/windows/.clang-tidy with header error filtering${colors.reset}`,
    );
    console.log(
      `${colors.dim}Note: System header errors are automatically filtered out${colors.reset}`,
    );
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

// Run
main().catch((err) => {
  console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
  process.exit(1);
});
