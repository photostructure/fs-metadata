import {
  analyzeSanitizerOutput,
  isKnownMacosSipFailure,
  parseSanitizerCliArgs,
} from "./sanitizer-output";

const MacosSipOutput = `==38863==ERROR: Interceptors are not working. This may be because AddressSanitizer is loaded too late (e.g. via dlopen). Please launch the executable with:
DYLD_INSERT_LIBRARIES=/Library/Developer/CommandLineTools/usr/lib/clang/21/lib/darwin/libclang_rt.asan_osx_dynamic.dylib
"interceptors not installed" && 0`;

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

  it("recognizes the known macOS SIP interceptor failure", () => {
    expect(isKnownMacosSipFailure(MacosSipOutput)).toBe(true);
  });

  it("does not allow SIP text to mask a sanitizer report", () => {
    const output = `${MacosSipOutput}
==42== ERROR: AddressSanitizer heap-use-after-free`;
    expect(isKnownMacosSipFailure(output)).toBe(false);
  });

  it("does not allow SIP text to mask a Jest failure", () => {
    const output = `${MacosSipOutput}
No tests found, exiting with code 1`;
    expect(isKnownMacosSipFailure(output)).toBe(false);
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
  //   tsx scripts/analyze-sanitizer-output.ts <clean-file> "" --allow-macos-sip
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
    expect(() =>
      parseSanitizerCliArgs([
        "out.log",
        "1",
        "--allow-macos-sip",
        "--bogus",
      ]),
    ).toThrow(TypeError);
  });

  it("accepts an integer exit code, with or without the SIP flag", () => {
    expect(parseSanitizerCliArgs(["out.log", "0"])).toEqual({
      outputFile: "out.log",
      testExitCode: 0,
      allowMacosSip: false,
    });
    expect(
      parseSanitizerCliArgs(["out.log", "1", "--allow-macos-sip"]),
    ).toEqual({
      outputFile: "out.log",
      testExitCode: 1,
      allowMacosSip: true,
    });
  });
});
