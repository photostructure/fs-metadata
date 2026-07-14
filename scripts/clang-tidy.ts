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
        const result = execSync(`which clang-tidy${version}`, {
          encoding: "utf8",
        }).trim();
        // On macOS, return the full path if it's in Homebrew
        // This allows us to detect it for filtering purposes
        if (
          isMacOS &&
          (result.includes("/opt/homebrew") ||
            result.includes("/usr/local") ||
            result.includes("/Cellar"))
        ) {
          return result;
        }
        return `clang-tidy${version}`;
      } catch {
        // Continue trying
      }
    }

    // On macOS, check Homebrew locations explicitly
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

    // Find the MSVC include directory.
    //
    // vswhere.exe is the ONLY supported way to locate a Visual Studio install.
    // It ships at a fixed, versioned-forever path and is what node-gyp itself
    // uses, so it keeps working across VS editions, versions and future
    // releases. Hardcoding install paths does not: a guessed list of
    // 2022/{Community,Professional,Enterprise} + 2019/* matched nothing on the
    // GitHub `windows-latest` runner and failed the lint job outright.
    //
    // The hardcoded list is kept only as a last-resort fallback.
    const fs = require("fs");
    const msvcPaths: string[] = [];

    // 1. An active developer command prompt already tells us exactly where the
    //    toolset is.
    const vcToolsDir = process.env.VCToolsInstallDir;
    if (vcToolsDir) {
      console.log("VCToolsInstallDir is set:", vcToolsDir);
      msvcPaths.push(join(vcToolsDir, ".."));
    }

    // 2. vswhere.exe -- the supported way to locate a VS install. It lives at a
    //    fixed path that Microsoft commits to keeping stable, and it is what
    //    node-gyp itself uses.
    const vswhere =
      "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
    if (existsSync(vswhere)) {
      try {
        const installPath = execSync(
          `"${vswhere}" -latest -products * -property installationPath`,
          { encoding: "utf8" },
        ).trim();
        if (installPath) {
          console.log("vswhere found Visual Studio at:", installPath);
          msvcPaths.push(join(installPath, "VC", "Tools", "MSVC"));
        }
      } catch (error) {
        console.warn("vswhere failed:", error);
      }
    }

    // 3. Enumerate every <year>/<edition> under both Program Files roots.
    //    A hardcoded list of years and editions is what broke this on the
    //    GitHub `windows-latest` runner -- it matched nothing and failed the
    //    lint job. Enumerating cannot go stale when a new VS ships.
    for (const root of [
      "C:\\Program Files\\Microsoft Visual Studio",
      "C:\\Program Files (x86)\\Microsoft Visual Studio",
    ]) {
      if (!existsSync(root)) continue;
      for (const year of fs.readdirSync(root)) {
        const yearDir = join(root, year);
        let editions: string[];
        try {
          editions = fs.readdirSync(yearDir);
        } catch {
          continue; // not a directory (e.g. the Installer folder)
        }
        for (const edition of editions) {
          msvcPaths.push(join(yearDir, edition, "VC", "Tools", "MSVC"));
        }
      }
    }

    let msvcInclude = "";
    for (const basePath of msvcPaths) {
      if (!existsSync(basePath)) continue;
      let versions: string[];
      try {
        versions = fs.readdirSync(basePath);
      } catch {
        continue;
      }
      // Newest toolset wins. Sort numerically-ish so 14.9 < 14.44.
      versions.sort((a, b) =>
        b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }),
      );
      for (const version of versions) {
        const candidate = join(basePath, version, "include");
        // Only commit to `candidate` once it is known to exist -- otherwise a
        // stale non-existent path would satisfy the `!msvcInclude` guard below
        // and we would emit a compile database with no C++ standard library.
        if (existsSync(candidate)) {
          msvcInclude = candidate;
          console.log("Found MSVC includes at:", msvcInclude);
          break;
        }
      }
      if (msvcInclude) break;
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

    // Fail loudly rather than emitting a compile database with no C/C++ standard
    // library on the include path. That produces thousands of bogus cascading
    // errors in our own headers, which is exactly the condition the old output
    // filtering was invented to paper over.
    if (!msvcInclude) {
      throw new Error(
        `Could not locate the MSVC include directory. Searched:\n  ${msvcPaths.join("\n  ")}`,
      );
    }
    if (!sdkVersion) {
      throw new Error(
        `Could not locate a Windows SDK version under ${sdkBase}`,
      );
    }

    // Create compile commands with absolute paths.
    //
    // NOTE: this uses the `arguments` ARRAY form of the JSON compilation
    // database, NOT the `command` string form.
    //
    // The string form is shell-quoted, and every MSVC/Windows-SDK include path
    // contains spaces ("C:\Program Files (x86)\..."). Joining them with " " and
    // no quoting made clang split each path into garbage arguments:
    //     error: no such file or directory: 'Files'
    //     error: no such file or directory: '(x86)\Windows'
    // so the MSVC and SDK include directories were never actually passed. <cstring>
    // and friends then failed to resolve, which cascaded into bogus errors like
    // "use of undeclared identifier 'DEBUG_LOG'" in our own headers. Those bogus
    // errors are exactly what the old output filtering existed to hide.
    //
    // The `arguments` array is passed through verbatim -- no quoting, no splitting.
    const commands = sources.map((source: string) => ({
      directory: process.cwd(),
      file: source,
      arguments: [
        "clang++", // Use clang++ for clang-tidy compatibility
        "-c",
        source,
        // `src`, NOT `src/windows` -- this MUST match binding.gyp's
        // include_dirs. Putting src/windows on the angle-bracket search path is
        // actively harmful: MSVC's <cstring> does `#include <string.h>`, which
        // then resolves to our own src/windows/string.h instead of the UCRT's.
        // The C library then appears to have no memchr/strlen/..., cascading
        // into bogus "use of undeclared identifier 'DEBUG_LOG'" errors in our
        // headers. Files inside src/windows include each other with quote-form
        // includes, which resolve relative to the including file and need no -I.
        `-I${join(process.cwd(), "src")}`,
        `-I${join(process.cwd(), "node_modules", "node-addon-api")}`,
        `-I${join(nodeGyp, "include", "node")}`,
        msvcInclude ? `-I${msvcInclude}` : "",
        sdkVersion ? `-I${join(sdkBase, sdkVersion, "ucrt")}` : "",
        sdkVersion ? `-I${join(sdkBase, sdkVersion, "shared")}` : "",
        sdkVersion ? `-I${join(sdkBase, sdkVersion, "um")}` : "",
        sdkVersion ? `-I${join(sdkBase, sdkVersion, "winrt")}` : "",
        "-DWIN32",
        "-D_WINDOWS",
        "-D_WIN64",
        "-D_M_X64=1",
        "-D_AMD64_=1",
        // Keep these in step with binding.gyp: NAPI_VERSION=9, and C++20 (which
        // Node's common.gypi gives the real MSVC build via /std:c++20).
        "-DNAPI_VERSION=9",
        "-DNAPI_CPP_EXCEPTIONS",
        "-DNODE_ADDON_API_DISABLE_DEPRECATED",
        "-DBUILDING_NODE_EXTENSION",
        "-std=c++20",
        "-fms-compatibility",
        "-fms-extensions",
        "-Wno-microsoft-include",
      ].filter((arg) => arg),
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

  execSync("bear -- npm run node-gyp-rebuild", {
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
    let excludePattern: string;
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

/**
 * Count errors and warnings in clang-tidy output.
 *
 * There is deliberately NO message-text filtering here on any platform.
 *
 * The previous implementation dropped diagnostic lines matching patterns like
 * "no member named 'x' in namespace 'std'" or "'foo' file not found" to hide
 * toolchain/header mismatches. Those same patterns describe REAL bugs in
 * first-party code, and the filtering was hiding two of them plus the fact that
 * the analysis was fundamentally broken on both macOS and Windows (a bad
 * -isysroot, and a compile database whose MSVC include paths were mangled by
 * shell-quoting and which shadowed <string.h> with our own src/windows/string.h).
 *
 * Both root causes are fixed, so there is nothing legitimate left to filter.
 * If toolchain noise reappears, fix the toolchain configuration -- do not
 * reintroduce output filtering, which cannot distinguish it from a real defect.
 */
function tallyDiagnostics(output: string): {
  output: string;
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const line of output.split("\n")) {
    if (line.includes(" warning:")) warnings++;
    if (line.includes(" error:")) errors++;
  }
  return { output, errors, warnings };
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
    } else if (isMacOS) {
      // Homebrew's clang-tidy consumes a compile_commands.json produced by
      // Apple's /usr/bin/cc. All it needs is the macOS SDK sysroot -- it then
      // finds its OWN resource headers (stddef.h -> size_t/ptrdiff_t) and the
      // SDK's C headers and frameworks correctly.
      //
      // Do NOT reintroduce -nostdinc++ / -isystem <brew>/opt/llvm/include/c++/v1
      // / -isystem <sdk>/usr/include. That combination is what BREAKS the run:
      // it shadows clang's builtin include dir, so Apple's own <sys/_types.h>
      // fails with "unknown type name 'size_t'" and the analysis collapses into
      // hundreds of bogus errors. Measured on src/darwin/hidden.cpp:
      //   -isysroot only ............................ 0 errors
      //   -nostdinc++ + manual -isystem paths ...... 20 errors
      // Those bogus errors are precisely what the old message-text filtering
      // existed to hide. Fix the sysroot; don't filter the analyzer's output.
      const sdkPath = execSync("xcrun --show-sdk-path", {
        encoding: "utf8",
      }).trim();
      extraArgs = `--extra-arg=-isysroot${sdkPath}`;
    }

    const { stdout, stderr } = await exec(
      `${isWindows ? `"${clangTidy}"` : clangTidy} -p . ${extraArgs} "${file}" 2>&1`,
    );
    return { file, ...tallyDiagnostics(stdout + stderr) };
  } catch (error: any) {
    const raw: string = error.stdout || error.stderr || error.message;
    return { file, ...tallyDiagnostics(raw) };
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
        // Show warnings (already filtered on Windows)
        const warningLines = result.output
          .split("\n")
          .filter((line) => line.includes(" warning:"));
        warningLines.forEach((line) =>
          console.log(`  ${colors.dim}${line}${colors.reset}`),
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
          // Show warnings
          const warningLines = result.output
            .split("\n")
            .filter((line) => line.includes(" warning:"));
          warningLines.forEach((line) =>
            console.log(`  ${colors.dim}${line}${colors.reset}`),
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
      `\n${colors.dim}Windows: analyzed ${files.length} files; diagnostics are not filtered${colors.reset}`,
    );
  } else if (isMacOS) {
    console.log(
      `\n${colors.dim}macOS: analyzed ${files.length} files (src/darwin + src/common) against the Xcode SDK sysroot${colors.reset}`,
    );
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

// Run
main().catch((err) => {
  console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
  process.exit(1);
});
