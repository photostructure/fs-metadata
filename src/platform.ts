// src/platform.ts

import { platform } from "node:os";

const p = platform();

export const isLinux = p === "linux";
export const isWindows = p === "win32";
export const isMacOS = p === "darwin";
