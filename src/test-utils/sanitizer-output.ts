export type SanitizerOutputAnalysis = {
  failed: boolean;
  sanitizerReport: boolean;
  testFailure: boolean;
};

function hasHeaderPrefix(line: string, prefix: string): boolean {
  if (!line.startsWith(prefix)) return false;
  const boundary = line[prefix.length];
  return (
    boundary == null ||
    boundary === ":" ||
    boundary === " " ||
    boundary === "\t"
  );
}

function hasSanitizerErrorHeader(output: string): boolean {
  return output.split("\n").some((line) => {
    line = line.trimStart();
    if (line.startsWith("==")) {
      const prefixEnd = line.indexOf("==", 2);
      const pid = prefixEnd < 0 ? "" : line.slice(2, prefixEnd);
      if (
        pid.length > 0 &&
        [...pid].every((char) => char >= "0" && char <= "9")
      ) {
        line = line.slice(prefixEnd + 2).trimStart();
      }
    }
    return (
      hasHeaderPrefix(line, "ERROR: AddressSanitizer") ||
      hasHeaderPrefix(line, "ERROR: LeakSanitizer")
    );
  });
}

const MacosSipFailureRE =
  /^==\d+==ERROR: Interceptors are not working\. This may be because AddressSanitizer is loaded too late \(e\.g\. via dlopen\)\. Please launch the executable with:\nDYLD_INSERT_LIBRARIES=[^\n]+\/libclang_rt\.asan_osx_dynamic\.dylib\n"interceptors not installed" && 0$/;

/** True only when a failed macOS run is the known three-line SIP error. */
export function isKnownMacosSipFailure(output: string): boolean {
  return MacosSipFailureRE.test(output.replaceAll("\r\n", "\n"));
}

/** Decide whether one sanitizer test run must fail CI. */
export function analyzeSanitizerOutput(
  output: string,
  testExitCode: number,
): SanitizerOutputAnalysis {
  const sanitizerReport = hasSanitizerErrorHeader(output);
  const testFailure = testExitCode !== 0;
  return {
    failed: sanitizerReport || testFailure,
    sanitizerReport,
    testFailure,
  };
}

export type SanitizerCliArgs = {
  outputFile: string;
  testExitCode: number;
  allowMacosSip: boolean;
};

/**
 * Parse the CLI arguments for analyze-sanitizer-output.ts, given argv after the
 * script path (i.e. `process.argv.slice(2)`).
 *
 * The exit code must be an explicit integer literal: `Number("")` and
 * `Number(" ")` are both `0`, so a blank argument would otherwise be silently
 * accepted as a passing run and mask a real failure.
 *
 * @throws TypeError when the output file is missing, the exit code is not an
 * integer literal, or an unknown flag is passed.
 */
export function parseSanitizerCliArgs(
  args: readonly string[],
): SanitizerCliArgs {
  const [outputFile, rawExitCode, mode] = args;
  if (
    (args.length !== 2 && args.length !== 3) ||
    outputFile == null ||
    rawExitCode == null ||
    !/^-?\d+$/.test(rawExitCode) ||
    (mode != null && mode !== "--allow-macos-sip")
  ) {
    throw new TypeError(
      "Usage: analyze-sanitizer-output.ts <output-file> <test-exit-code> [--allow-macos-sip]",
    );
  }
  return {
    outputFile,
    testExitCode: Number(rawExitCode),
    allowMacosSip: mode === "--allow-macos-sip",
  };
}
