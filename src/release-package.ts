import { readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  assertExactFileSet,
  expectedPrebuildPaths,
} from "./release-prebuild-artifacts";

export interface PackageIdentity {
  name: string;
  version: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function assertIdentity(
  value: unknown,
  expected: PackageIdentity,
  source: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${source} is not a JSON object`);
  }
  if (
    value["name"] !== expected.name ||
    value["version"] !== expected.version
  ) {
    throw new Error(
      `${source} identifies ${String(value["name"])}@${String(value["version"])}, expected ${expected.name}@${expected.version}`,
    );
  }
  return value;
}

/**
 * Validates `npm pack --json` output against the expected identity and returns
 * the single tarball filename it reports.
 */
export function packedFilename(
  packJson: unknown,
  expected: PackageIdentity,
): string {
  if (!Array.isArray(packJson) || packJson.length !== 1) {
    throw new Error(
      `Expected one npm pack record, found ${Array.isArray(packJson) ? packJson.length : "a non-array"}`,
    );
  }
  const record = assertIdentity(packJson[0], expected, "The npm pack record");
  const filename = record["filename"];
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("The npm pack record has no filename");
  }
  return filename;
}

/** Validates the `package.json` extracted from inside the packed tarball. */
export function assertPackedManifest(
  manifest: unknown,
  expected: PackageIdentity,
): void {
  assertIdentity(manifest, expected, "The packed manifest");
}

/** Verifies that every expected native binary appears once in the tar listing. */
export function assertPackedPrebuilds(
  contents: readonly string[],
  packageName: string,
): void {
  const actualFiles = contents.filter((file) => file.endsWith(".node"));
  const expectedFiles = expectedPrebuildPaths(packageName).map(
    (file) => `package/${file}`,
  );
  assertExactFileSet(actualFiles, expectedFiles, "Packed prebuild set");
}

/** Locates the one tarball in a package artifact directory. */
export async function findTarball(directory: string): Promise<string> {
  const tarballs = (await readdir(directory)).filter((entry) =>
    entry.endsWith(".tgz"),
  );
  const only = tarballs[0];
  if (tarballs.length !== 1 || only == null) {
    throw new Error(
      `Expected exactly one tarball in ${directory}, found ${tarballs.join(", ") || "none"}`,
    );
  }
  return join(directory, only);
}
