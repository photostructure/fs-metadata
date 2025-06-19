// src/test-utils/platform.ts

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { env, platform } from "node:process";
import { normalizePath } from "../path";
import { isAlpine, isARM64, isMacOS, isWindows } from "../platform";
import { toNotBlank } from "../string";

/**
 * Helper function to skip tests based on platform
 * @param platform The platform to run tests on ('win32', 'darwin', 'linux')
 * @returns jest.Describe function that only runs on specified platform
 */
export function describePlatform(...supported: NodeJS.Platform[]) {
  return supported.includes(platform) ? describe : describe.skip;
}

export function skipItIf(skipped: NodeJS.Platform[]): jest.It {
  return skipped.includes(platform) ? it.skip : it;
}

export function runItIf(included: NodeJS.Platform[]): jest.It {
  return included.includes(platform) ? it : it.skip;
}

export function systemDrive() {
  if (isWindows) {
    return normalizePath(
      toNotBlank(env["SystemDrive"] ?? "") ?? "C:\\",
    ) as string;
  } else {
    return "/";
  }
}

export function tmpDirNotHidden() {
  const dir = isMacOS
    ? join(homedir(), "tmp")
    : isWindows
      ? join(systemDrive(), "tmp")
      : "/tmp";

  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Skip timing-sensitive tests on Alpine ARM64 due to emulation timing issues
 */
export const itSkipAlpineARM64 = isAlpine() && isARM64 ? it.skip : it;

/**
 * Skip timing-sensitive describe blocks on Alpine ARM64 due to emulation timing issues
 */
export const describeSkipAlpineARM64 =
  isAlpine() && isARM64 ? describe.skip : describe;

/**
 * Skip tests on ARM64 CI environments due to various issues:
 * - Alpine ARM64: emulation timing issues
 * - Windows ARM64: Jest worker process failures
 */
export const describeSkipARM64CI = 
  (isARM64 && env["CI"]) ? describe.skip : describe;

export const itSkipARM64CI = 
  (isARM64 && env["CI"]) ? it.skip : it;

/**
 * Helper for platform-specific tests that should also skip on ARM64 CI
 * @param supported The platforms to run tests on
 * @returns jest.Describe function that runs on specified platforms but skips on ARM64 CI
 */
export function describePlatformSkipARM64CI(...supported: NodeJS.Platform[]) {
  if (isARM64 && env["CI"]) {
    return describe.skip;
  }
  return describePlatform(...supported);
}
