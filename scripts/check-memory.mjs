#!/usr/bin/env node

/**
 * Cross-platform memory checking script
 * Runs JavaScript memory tests on all platforms
 * Runs valgrind and ASAN tests only on Linux
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import os from "os";
import path from "path";

// Colors for output
const colors = {
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  RESET: "\x1b[0m",
};

// Use colors only if not on Windows
const isWindows = os.platform() === "win32";
const color = (colorCode, text) =>
  isWindows ? text : `${colorCode}${text}${colors.RESET}`;

console.log(color(colors.BLUE, "=== Memory Leak Detection Suite ==="));

let exitCode = 0;

// 1. Run JavaScript memory tests (all platforms)
console.log(color(colors.YELLOW, "\nRunning JavaScript memory tests..."));
try {
  execSync("npm run test:memory", { stdio: "inherit" });
  console.log(color(colors.GREEN, "✓ JavaScript memory tests passed"));
} catch {
  console.log(color(colors.RED, "✗ JavaScript memory tests failed"));
  exitCode = 1;
}

// 2. Run valgrind if available and on Linux
if (os.platform() === "linux") {
  try {
    execSync("which valgrind", { stdio: "ignore" });
    console.log(color(colors.YELLOW, "\nRunning valgrind memory analysis..."));
    try {
      execSync("npm run test:valgrind", { stdio: "inherit" });
      console.log(color(colors.GREEN, "✓ Valgrind tests passed"));
    } catch {
      console.log(color(colors.RED, "✗ Valgrind tests failed"));
      exitCode = 1;
    }
  } catch {
    console.log(color(colors.YELLOW, "\nValgrind not available. Skipping."));
  }
} else {
  console.log(
    color(colors.YELLOW, "\nValgrind tests only run on Linux. Skipping."),
  );
}

// 3. Run Address Sanitizer if requested (Linux only for now)
if (process.env.ENABLE_ASAN) {
  if (os.platform() === "linux") {
    console.log(color(colors.YELLOW, "\nBuilding with AddressSanitizer..."));
    try {
      // Check if clang is available
      execSync("which clang", { stdio: "ignore" });

      const env = {
        ...process.env,
        CC: "clang",
        CXX: "clang++",
        CFLAGS: "-fsanitize=address -fno-omit-frame-pointer -g -O1",
        CXXFLAGS: "-fsanitize=address -fno-omit-frame-pointer -g -O1",
        LDFLAGS: "-fsanitize=address",
        ASAN_OPTIONS: "detect_leaks=1:halt_on_error=0:print_stats=1",
        LSAN_OPTIONS: `suppressions=${path.join(process.cwd(), ".lsan-suppressions.txt")}:print_suppressions=0`,
      };

      // Find ASan runtime library using clang
      try {
        const asanLib = execSync(
          "clang -print-file-name=libclang_rt.asan-x86_64.so",
          { encoding: "utf8" },
        ).trim();
        if (asanLib && !asanLib.includes("not found")) {
          env.LD_PRELOAD = asanLib;
          console.log(color(colors.BLUE, `Using ASan library: ${asanLib}`));
        }
      } catch {
        // Try common paths as fallback
        const asanLibPaths = [
          "/usr/lib/x86_64-linux-gnu/libasan.so.8",
          "/usr/lib/x86_64-linux-gnu/libasan.so.6",
          "/usr/lib64/libasan.so.8",
          "/usr/lib64/libasan.so.6",
        ];

        for (const libPath of asanLibPaths) {
          try {
            execSync(`test -f ${libPath}`, { stdio: "ignore" });
            env.LD_PRELOAD = libPath;
            console.log(color(colors.BLUE, `Using ASan library: ${libPath}`));
            break;
          } catch {
            // Try next path
          }
        }
      }

      execSync("npm run node-gyp-rebuild", { stdio: "inherit", env });

      console.log(
        color(colors.YELLOW, "Running tests with AddressSanitizer..."),
      );

      // Capture ASAN output for analysis
      let asanOutput = "";
      try {
        asanOutput = execSync("npm test -- --no-coverage 2>&1", {
          env,
        }).toString();
        console.log(asanOutput);
      } catch (error) {
        asanOutput = error.stdout ? error.stdout.toString() : "";
        asanOutput += error.stderr ? error.stderr.toString() : "";
        console.log(asanOutput);
      }

      // Save full output to file
      const outputFile = path.join(process.cwd(), "asan-output.log");
      writeFileSync(outputFile, asanOutput);
      console.log(
        color(colors.BLUE, `\nFull ASAN output saved to: ${outputFile}`),
      );

      // Check for ASAN errors in our code (not V8/Node internals)
      const lines = asanOutput.split("\n");
      const hasOurErrors = lines.some(
        (line) =>
          (line.includes("ERROR: AddressSanitizer") ||
            line.includes("ERROR: LeakSanitizer")) &&
          (line.includes("fs_metadata.node") || line.includes("/src/")),
      );

      const hasOurLeaks = lines.some(
        (line) =>
          (line.includes("Direct leak") || line.includes("Indirect leak")) &&
          lines
            .slice(
              Math.max(0, lines.indexOf(line) - 5),
              lines.indexOf(line) + 10,
            )
            .some(
              (context) =>
                context.includes("fs_metadata.node") ||
                context.includes("/src/"),
            ),
      );

      // Count V8/Node internal leaks for information
      const internalLeaks = (asanOutput.match(/leak.*\/usr\/bin\/node/g) || [])
        .length;

      if (hasOurErrors || hasOurLeaks) {
        console.log(
          color(
            colors.RED,
            "\n✗ AddressSanitizer found issues in fs-metadata code:",
          ),
        );

        // Extract relevant error lines
        const relevantErrors = lines.filter((line, idx) => {
          if (line.includes("ERROR:") || line.includes("leak")) {
            // Check context around this line for our code
            const context = lines
              .slice(Math.max(0, idx - 5), idx + 10)
              .join("\n");
            return (
              context.includes("fs_metadata.node") || context.includes("/src/")
            );
          }
          return false;
        });

        relevantErrors.forEach((line) => console.log(color(colors.RED, line)));
        exitCode = 1;
      } else {
        console.log(
          color(
            colors.GREEN,
            "✓ AddressSanitizer tests passed (no issues in fs-metadata code)",
          ),
        );
        if (internalLeaks > 0) {
          console.log(
            color(
              colors.YELLOW,
              `   Note: ${internalLeaks} V8/Node.js internal leaks detected (suppressed)`,
            ),
          );
        }
      }
    } catch (error) {
      if (error && error.code === 1) {
        console.log(
          color(
            colors.YELLOW,
            "clang not found. Skipping AddressSanitizer tests.",
          ),
        );
      } else {
        console.log(color(colors.RED, "✗ AddressSanitizer tests failed"));
        exitCode = 1;
      }
    }
  } else {
    console.log(
      color(
        colors.YELLOW,
        "\nAddressSanitizer tests are currently only supported on Linux. Skipping.",
      ),
    );
  }
}

if (exitCode === 0) {
  console.log(
    color(colors.GREEN, "\n=== All memory tests completed successfully! ==="),
  );
} else {
  console.log(color(colors.RED, "\n=== Some memory tests failed ==="));
}

process.exit(exitCode);
