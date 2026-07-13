export type SanitizerOutputAnalysis = {
  failed: boolean;
  sanitizerReport: boolean;
  testFailure: boolean;
};

function hasHeaderPrefix(
  line: string,
  prefix: string,
  requireColon = false,
): boolean {
  if (!line.startsWith(prefix)) return false;
  const boundary = line[prefix.length];
  if (requireColon) return boundary === ":";
  return (
    boundary == null ||
    boundary === ":" ||
    boundary === " " ||
    boundary === "\t"
  );
}

type ReportHeader = {
  prefix: string;
  /** Require a `:` immediately after the prefix, so prose doesn't match. */
  requireColon?: boolean;
};

/**
 * Headers that mean a sanitizer found something. A run can print any of these
 * and still exit 0, so the exit code alone is never a sufficient gate.
 */
const ReportHeaders: readonly ReportHeader[] = [
  { prefix: "ERROR: AddressSanitizer" },
  { prefix: "ERROR: LeakSanitizer" },
  { prefix: "ERROR: ThreadSanitizer" },
  { prefix: "ERROR: UndefinedBehaviorSanitizer" },
  { prefix: "ERROR: MemorySanitizer" },
  // ThreadSanitizer reports data races and lock-order inversions under a
  // WARNING: header -- NOT ERROR: -- and exits 0 unless halt_on_error is set.
  // Gating only on "ERROR:" would let every race through silently. The colon is
  // required so prose like "WARNING: ThreadSanitizer is slow" does not match.
  { prefix: "WARNING: ThreadSanitizer", requireColon: true },
  { prefix: "SUMMARY: ThreadSanitizer", requireColon: true },
  { prefix: "SUMMARY: UndefinedBehaviorSanitizer", requireColon: true },
];

/**
 * UndefinedBehaviorSanitizer's *recoverable* form: it prints
 * `<file>:<line>:<col>: runtime error: <what>` and CONTINUES, leaving the
 * process to exit 0 with real undefined behavior found. Anchoring on the
 * file:line:col prefix keeps prose like "no runtime errors detected" from
 * matching.
 */
const UbsanRuntimeErrorRE = /:\d+:\d+: runtime error: /;

function hasSanitizerReport(output: string): boolean {
  return output.split("\n").some((raw) => {
    let line = raw.trimStart();
    if (UbsanRuntimeErrorRE.test(line)) return true;
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
    return ReportHeaders.some((header) =>
      hasHeaderPrefix(line, header.prefix, header.requireColon),
    );
  });
}

/** Decide whether one sanitizer test run must fail CI. */
export function analyzeSanitizerOutput(
  output: string,
  testExitCode: number,
): SanitizerOutputAnalysis {
  const sanitizerReport = hasSanitizerReport(output);
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
  const [outputFile, rawExitCode] = args;
  if (
    args.length !== 2 ||
    outputFile == null ||
    rawExitCode == null ||
    !/^-?\d+$/.test(rawExitCode)
  ) {
    throw new TypeError(
      "Usage: analyze-sanitizer-output.ts <output-file> <test-exit-code>",
    );
  }
  return {
    outputFile,
    testExitCode: Number(rawExitCode),
  };
}
