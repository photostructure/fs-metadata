// src/test-utils/platform.ts

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { env, platform } from "node:process";
import { normalizePath } from "../path.js";
import { isMacOS, isWindows } from "../platform.js";
import { toNotBlank } from "../string.js";

/**
 * Helper function to skip tests based on platform
 * @param platform The platform to run tests on ('win32', 'darwin', 'linux')
 * @returns jest.Describe function that only runs on specified platform
 */
export function describePlatform(...supported: NodeJS.Platform[]) {
  return supported.includes(platform) ? describe : describe.skip;
}

export function systemDrive() {
  if (isWindows) {
    return normalizePath(toNotBlank(env["SystemDrive"] ?? "") ?? "C:\\") as string;
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
