#!/usr/bin/env node
import { platform } from "node:os";

const targetPlatform = process.argv[2];
if (!targetPlatform) {
  console.error("Usage: is-platform.mjs <platform>");
  console.error("Example: is-platform.mjs win32");
  process.exit(2);
}

// Exit with 0 if current platform matches target, 1 otherwise
process.exit(platform() === targetPlatform ? 0 : 1);
