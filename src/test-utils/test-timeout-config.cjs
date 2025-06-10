// @ts-check

const fs = require("node:fs");
const { arch, platform } = require("node:process");

/**
 * Detects if we're running on Alpine Linux by checking /etc/os-release
 * @returns {boolean}
 */
function isAlpineLinux() {
  if (platform !== "linux") return false;

  try {
    const osRelease = fs.readFileSync("/etc/os-release", "utf8");
    return (
      osRelease.includes("Alpine Linux") || osRelease.includes("ID=alpine")
    );
  } catch {
    // Also check the legacy file
    return fs.existsSync("/etc/alpine-release");
  }
}

/**
 * Detects if we're likely running under emulation (e.g., Docker on different arch)
 * @returns {boolean}
 */
function isEmulated() {
  // Alpine ARM64 is always emulated in CI since GitHub Actions doesn't have native ARM64 runners
  // This is true even inside Docker containers where GITHUB_ACTIONS env vars might not be present
  if (isAlpineLinux() && arch === "arm64") {
    return true;
  }
  
  // In GitHub Actions, we can check if we're running in a container with platform specified
  if (process.env.GITHUB_ACTIONS && process.env.RUNNER_OS === "Linux") {
    // If we're on Alpine ARM64, we're likely emulated on x64 runners
    return isAlpineLinux() && arch === "arm64";
  }
  return false;
}

/**
 * Get timing multiplier for the current environment
 * @returns {number}
 */
function getTimingMultiplier() {
  // Base multipliers
  let multiplier = 1;

  // Alpine is slower due to musl libc
  if (isAlpineLinux()) multiplier *= 2;

  // ARM emulation is extremely slow
  if (isEmulated()) multiplier *= 10;

  // Windows is slow to fork
  if (platform === "win32") multiplier *= 4;

  // MacOS VMs are glacial:
  if (platform === "darwin") multiplier *= 4;

  return multiplier;
}

/**
 * Get appropriate test timeout for the current environment.
 *
 * Timeouts are adjusted based on:
 * - CI vs local development
 * - Operating system (Windows is slow with process forking)
 * - Architecture (ARM64 emulation is very slow)
 * - Container environment (Alpine Linux needs more time)
 *
 * @param {number} [baseTimeout] - Base timeout in milliseconds (default: 10000)
 * @returns {number} Timeout in milliseconds
 */
function getTestTimeout(baseTimeout = 10000) {
  // Always apply multipliers for emulated environments (e.g., Alpine ARM64)
  // This is important because CI env vars may not be available inside Docker containers
  if (isEmulated()) {
    const multiplier = getTimingMultiplier();
    return baseTimeout * multiplier;
  }

  // Apply multipliers in CI or when GITHUB_ACTIONS is set
  if (!process.env.CI && !process.env.GITHUB_ACTIONS) {
    return baseTimeout; // Local development uses base timeout
  }

  // Apply environment-specific multipliers
  const multiplier = getTimingMultiplier();
  return baseTimeout * multiplier;
}
module.exports = {
  isEmulated,
  isAlpineLinux,
  getTestTimeout,
  getTimingMultiplier,
};
