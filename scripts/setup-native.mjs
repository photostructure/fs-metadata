#!/usr/bin/env node

// scripts/configure.mjs

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { platform } from "node:os";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

function hasGio() {
  if (platform() !== "linux") return false;
  try {
    execSync("pkg-config --exists gio-2.0", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function configure() {
  // Create a gyp config file that node-gyp will read
  const config = {
    variables: {
      "enable_gio%": hasGio() ? "true" : "false",
    },
  };

  const payload = JSON.stringify(config, null, 2);
  writeFileSync("config.gypi", payload);
}

// If the script is run directly, call the configure function
if (import.meta.url === pathToFileURL(argv[1]).href) {
  configure();
}
