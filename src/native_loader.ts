// src/native_loader.ts

import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defer } from "./defer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PrebuiltInfo {
  file: string;
  runtime: string;
  napi?: boolean;
  abi?: string;
  uv?: string;
  specificity: number;
}

function findPrebuiltModule(): string {
  // Get current platform info
  const currentPlatform = platform();
  const currentArch = arch();
  const currentAbi = process.versions.modules;
  const runtime = "node"; // We only support Node.js runtime for now

  // Find matching prebuilds directory
  const prebuildsDir = join(__dirname, "..", "prebuilds");
  const tuple = findMatchingTuple(prebuildsDir, currentPlatform, currentArch);

  if (!tuple) {
    throw new Error(
      `No prebuilt module found for ${currentPlatform}-${currentArch}`,
    );
  }

  // Find best matching .node file
  const prebuildFiles = readdirSync(join(prebuildsDir, tuple));
  const candidates = prebuildFiles
    .map(parseTags)
    .filter((tags) => tags != null)
    .filter((tags) => matchTags(tags, runtime, currentAbi));

  if (!candidates.length) {
    throw new Error(
      `No compatible native module found for Node ABI ${currentAbi} (${runtime})`,
    );
  }

  // Sort by specificity and return best match
  candidates.sort((a, b) => b.specificity - a.specificity);
  return join(prebuildsDir, tuple, candidates[0].file);
}

function findMatchingTuple(
  prebuildsDir: string,
  platform: string,
  arch: string,
): string | undefined {
  const tuples = readdirSync(prebuildsDir);

  for (const tuple of tuples) {
    const [tuplePlatform, archList] = tuple.split("-");
    if (tuplePlatform === platform && archList.split("+").includes(arch)) {
      return tuple;
    }
  }
  return;
}

function parseTags(filename: string): PrebuiltInfo | null {
  if (!filename.endsWith(".node")) return null;

  const tags = filename.slice(0, -5).split(".");
  const info: PrebuiltInfo = {
    file: filename,
    runtime: "node",
    specificity: 0,
  };

  for (const tag of tags) {
    if (tag === "node" || tag === "electron") {
      info.runtime = tag;
      info.specificity++;
    } else if (tag === "napi") {
      info.napi = true;
      info.specificity++;
    } else if (tag.startsWith("abi")) {
      info.abi = tag.slice(3);
      info.specificity++;
    } else if (tag.startsWith("uv")) {
      info.uv = tag.slice(2);
      info.specificity++;
    }
  }

  return info;
}

function matchTags(tags: PrebuiltInfo, runtime: string, abi: string): boolean {
  if (!tags) return false;
  if (tags.runtime !== runtime) return false;
  if (tags.abi && tags.abi !== abi && !tags.napi) return false;
  return true;
}

export const native = defer(() => {
  const modulePath = findPrebuiltModule();
  return createRequire(import.meta.url)(modulePath);
});
