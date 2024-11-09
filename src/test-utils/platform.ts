// src/test-utils/platform.ts

/**
 * Helper function to skip tests based on platform
 * @param platform The platform to run tests on ('win32', 'darwin', 'linux')
 * @returns jest.Describe function that only runs on specified platform
 */
export function describePlatform(platform: NodeJS.Platform) {
  return process.platform === platform ? describe : describe.skip;
}
