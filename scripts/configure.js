#!/usr/bin/env node

// scripts/configure.js

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { platform } from "node:os";

function hasGio() {
  if (platform() !== "linux") return false;
  try {
    execSync("pkg-config --exists gio-2.0", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Create a gyp config file that node-gyp will read
const config = {
  variables: {
    "enable_gio%": hasGio() ? "true" : "false",
  },
};

const payload = JSON.stringify(config, null, 2);
writeFileSync("config.gypi", payload);
