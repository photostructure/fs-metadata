import { readFile } from "node:fs/promises";
import {
  analyzeSanitizerOutput,
  parseSanitizerCliArgs,
} from "../src/test-utils/sanitizer-output";

async function main(): Promise<void> {
  const { outputFile, testExitCode } = parseSanitizerCliArgs(
    process.argv.slice(2),
  );

  const output = await readFile(outputFile, "utf8");
  const analysis = analyzeSanitizerOutput(output, testExitCode);
  if (analysis.testFailure) {
    console.error(`Sanitizer test pipeline exited with ${testExitCode}`);
  }
  if (analysis.sanitizerReport) {
    console.error("A sanitizer reported an error (ASan/LSan/UBSan/TSan)");
  }
  process.exitCode = analysis.failed ? 1 : 0;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
