// src/platform.ts

import { existsSync, readFileSync } from "node:fs";
import { arch, platform } from "node:process";

export const isLinux = platform === "linux";
export const isWindows = platform === "win32";
export const isMacOS = platform === "darwin";

export const isArm = isLinux && arch.startsWith("arm");
export const isARM64 = arch === "arm64";

/**
 * Detects if we're running on Alpine Linux by checking /etc/os-release
 */
export function isAlpine(): boolean {
  if (!isLinux) return false;

  try {
    const osRelease = readFileSync("/etc/os-release", "utf8");
    return (
      osRelease.includes("Alpine Linux") || osRelease.includes("ID=alpine")
    );
  } catch {
    return existsSync("/etc/alpine-release");
  }
}

/**
 * Detects if we're likely running under emulation (as of 202506 there aren't free GHA ARM64 runners)
 */
export function isEmulated(): boolean {
  return isLinux && isARM64;
}
