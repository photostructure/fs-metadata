import { readFile } from "node:fs/promises";
import {
  analyzeSanitizerOutput,
  isKnownMacosSipFailure,
  parseSanitizerCliArgs,
} from "../src/test-utils/sanitizer-output";

async function main(): Promise<void> {
  const { outputFile, testExitCode, allowMacosSip } = parseSanitizerCliArgs(
    process.argv.slice(2),
  );

  const output = await readFile(outputFile, "utf8");
  const knownMacosSipFailure =
    allowMacosSip && testExitCode !== 0 && isKnownMacosSipFailure(output);
  const analysis = analyzeSanitizerOutput(
    output,
    knownMacosSipFailure ? 0 : testExitCode,
  );
  if (knownMacosSipFailure) {
    console.error("Ignoring known macOS SIP interceptor startup failure");
  }
  if (analysis.testFailure) {
    console.error(`Sanitizer test pipeline exited with ${testExitCode}`);
  }
  if (analysis.sanitizerReport) {
    console.error("AddressSanitizer or LeakSanitizer reported an error");
  }
  process.exitCode = analysis.failed ? 1 : 0;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
