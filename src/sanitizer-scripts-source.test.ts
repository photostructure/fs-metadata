import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { _dirname } from "./dirname";

describe("sanitizer script failure propagation", () => {
  let checkMemorySource: string;
  let macosAsanSource: string;

  beforeAll(async () => {
    const scriptsDir = join(_dirname(), "..", "scripts");
    [checkMemorySource, macosAsanSource] = await Promise.all([
      readFile(join(scriptsDir, "check-memory.ts"), "utf8"),
      readFile(join(scriptsDir, "macos-asan.sh"), "utf8"),
    ]);
  });

  it("captures a nonzero macOS test result before analysis", () => {
    const disableErrexit = macosAsanSource.indexOf("set +e");
    const runTests = macosAsanSource.indexOf(
      'TEST_OUTPUT=$(TEST_ESM=0 "$NODE_BIN" node_modules/jest/bin/jest.js',
    );
    const captureStatus = macosAsanSource.indexOf("TEST_EXIT_CODE=$?");
    const restoreErrexit = macosAsanSource.indexOf("set -e", captureStatus);
    expect(disableErrexit).toBeGreaterThan(-1);
    expect(runTests).toBeGreaterThan(disableErrexit);
    expect(captureStatus).toBeGreaterThan(runTests);
    expect(restoreErrexit).toBeGreaterThan(captureStatus);
    expect(macosAsanSource).toContain("ANALYSIS_EXIT_CODE=$?");
  });

  it("analyzes captured output regardless of the test exit code", () => {
    // The analyzer must run before the exit-code branch so a sanitizer report
    // emitted with a zero exit code (e.g. LSAN_OPTIONS=exitcode=0) is still
    // scanned, mirroring the unconditional analysis in sanitizers-test.sh.
    const analyze = macosAsanSource.indexOf("analyze-sanitizer-output.ts");
    const analysisStatus = macosAsanSource.indexOf("ANALYSIS_EXIT_CODE=$?");
    const exitCodeBranch = macosAsanSource.indexOf("ANALYSIS_EXIT_CODE -ne 0");
    expect(analyze).toBeGreaterThan(-1);
    // Analyzer runs, its status is captured, and only then does the exit-code
    // branch pick the success wording — the analysis is never bypassed.
    expect(analysisStatus).toBeGreaterThan(analyze);
    expect(exitCodeBranch).toBeGreaterThan(analysisStatus);
  });

  it("propagates macOS sanitizer-script failures from the orchestrator", () => {
    const failureMessage = checkMemorySource.indexOf(
      "macOS sanitizer or leak tests failed",
    );
    const failureStatus = checkMemorySource.indexOf(
      "exitCode = 1",
      failureMessage,
    );
    expect(failureMessage).toBeGreaterThan(-1);
    expect(failureStatus).toBeGreaterThan(failureMessage);
  });
});
