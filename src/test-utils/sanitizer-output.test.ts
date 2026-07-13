import {
  analyzeSanitizerOutput,
  parseSanitizerCliArgs,
} from "./sanitizer-output";

describe("analyzeSanitizerOutput", () => {
  it("fails on a multiline AddressSanitizer report", () => {
    const output = `==42== ERROR: AddressSanitizer heap-use-after-free
READ of size 4 at 0x1234
    #0 0x1234 in Probe /workspace/src/windows/probe.cpp:42
    #1 0x5678 in fs_metadata.node
SUMMARY: AddressSanitizer: heap-use-after-free
`;
    expect(analyzeSanitizerOutput(output, 0)).toMatchObject({
      failed: true,
      sanitizerReport: true,
    });
  });

  it("fails on a LeakSanitizer report", () => {
    const output = `==42==ERROR: LeakSanitizer: detected memory leaks

Direct leak of 32 byte(s)
    #0 0x1234 in malloc
SUMMARY: AddressSanitizer: 32 byte(s) leaked
`;
    expect(analyzeSanitizerOutput(output, 0).failed).toBe(true);
  });

  // ThreadSanitizer reports data races under a *WARNING:* header, not ERROR:.
  // Gating only on "ERROR:" would let every race through with a zero exit.
  it("fails on a ThreadSanitizer data race (WARNING header)", () => {
    const output = `==================
WARNING: ThreadSanitizer: data race (pid=1234)
  Write of size 1 at 0x5555 by thread T2:
    #0 FSMeta::Debug::SetDebugPrefix /workspace/src/common/debug_log.h:21
  Previous read of size 1 at 0x5555 by main thread:
    #0 FSMeta::Debug::enableDebugLogging /workspace/src/binding.cpp:27
SUMMARY: ThreadSanitizer: data race /workspace/src/common/debug_log.h:21
==================
`;
    expect(analyzeSanitizerOutput(output, 0)).toMatchObject({
      failed: true,
      sanitizerReport: true,
    });
  });

  it("fails on a ThreadSanitizer lock-order-inversion", () => {
    const output = `WARNING: ThreadSanitizer: lock-order-inversion (potential deadlock) (pid=99)
SUMMARY: ThreadSanitizer: lock-order-inversion`;
    expect(analyzeSanitizerOutput(output, 0).failed).toBe(true);
  });

  // UBSan is *recoverable by default*: it prints "runtime error:" and keeps
  // going, so the process can still exit 0 with real undefined behavior found.
  it("fails on a recoverable UndefinedBehaviorSanitizer runtime error", () => {
    const output = `/workspace/src/linux/volume_metadata.cpp:88:22: runtime error: signed integer overflow: 9223372036854775807 + 1 cannot be represented in type 'long'
SUMMARY: UndefinedBehaviorSanitizer: undefined-behavior /workspace/src/linux/volume_metadata.cpp:88:22 in
`;
    expect(analyzeSanitizerOutput(output, 0)).toMatchObject({
      failed: true,
      sanitizerReport: true,
    });
  });

  it("fails on a halting UndefinedBehaviorSanitizer error header", () => {
    const output = `==42==ERROR: UndefinedBehaviorSanitizer: undefined-behavior /workspace/src/binding.cpp:12:3`;
    expect(analyzeSanitizerOutput(output, 0).failed).toBe(true);
  });

  it("fails when the test pipeline exits nonzero", () => {
    expect(analyzeSanitizerOutput("Tests failed", 1)).toMatchObject({
      failed: true,
      testFailure: true,
    });
  });

  it("ignores benign mentions without an error header", () => {
    expect(
      analyzeSanitizerOutput("Running AddressSanitizer tests", 0).failed,
    ).toBe(false);
  });

  it.each([
    "Running ThreadSanitizer tests...",
    "Building with UndefinedBehaviorSanitizer...",
    "WARNING: ThreadSanitizer is slow", // not a report header
    "no runtime errors detected",
  ])("does not false-positive on benign line: %s", (line) => {
    expect(analyzeSanitizerOutput(line, 0).failed).toBe(false);
  });

  it("passes clean output with a successful test status", () => {
    expect(analyzeSanitizerOutput("All tests passed", 0)).toEqual({
      failed: false,
      sanitizerReport: false,
      testFailure: false,
    });
  });
});

describe("parseSanitizerCliArgs", () => {
  // Regression: `Number("")` and `Number(" ")` are both 0, so a blank exit-code
  // argument would otherwise be accepted as a passing run and mask a real
  // failure. Verified against the CLI before the fix:
  //   tsx scripts/analyze-sanitizer-output.ts <clean-file> ""
  //   -> exit 0 (masked). After the fix the blank argument is rejected.
  it("rejects a blank exit-code argument", () => {
    expect(() => parseSanitizerCliArgs(["out.log", ""])).toThrow(TypeError);
    expect(() => parseSanitizerCliArgs(["out.log", " "])).toThrow(TypeError);
  });

  it("rejects a non-integer exit-code argument", () => {
    expect(() => parseSanitizerCliArgs(["out.log", "abc"])).toThrow(TypeError);
    expect(() => parseSanitizerCliArgs(["out.log", "1.5"])).toThrow(TypeError);
  });

  it("rejects a missing output file", () => {
    expect(() => parseSanitizerCliArgs([])).toThrow(TypeError);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseSanitizerCliArgs(["out.log", "1", "--bogus"])).toThrow(
      TypeError,
    );
  });

  it("accepts an integer exit code", () => {
    expect(parseSanitizerCliArgs(["out.log", "0"])).toEqual({
      outputFile: "out.log",
      testExitCode: 0,
    });
  });
});
