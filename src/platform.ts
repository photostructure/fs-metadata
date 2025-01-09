// src/platform.ts

import { arch, platform } from "node:process";

export const isLinux = platform === "linux";
export const isWindows = platform === "win32";
export const isMacOS = platform === "darwin";

export const isArm = isLinux && arch.startsWith("arm");
