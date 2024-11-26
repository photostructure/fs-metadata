// src/test-utils/platform.ts

import { join } from "node:path";
import { env, platform } from "node:process";
import { isWindows } from "../platform.js";
import { toNotBlank } from "../string.js";

/**
 * Helper function to skip tests based on platform
 * @param platform The platform to run tests on ('win32', 'darwin', 'linux')
 * @returns jest.Describe function that only runs on specified platform
 */
export function describePlatform(...supported: NodeJS.Platform[]) {
  return supported.includes(platform) ? describe : describe.skip;
}

export function tmpDirNotHidden() {
  if (isWindows) {
    const systemDrive = toNotBlank(env["SystemDrive"] ?? "") ?? "C:\\";
    return join(systemDrive, "tmp");
  } else {
    return "/tmp";
  }
}
