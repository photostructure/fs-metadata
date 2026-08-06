import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { sha256File } from "./release-prebuild-artifacts";

/**
 * The checksum file that travels with the packed tarball between the pack job
 * and every job that consumes it.
 */
export const checksumFileName = "SHA256SUMS";

export interface ChecksumEntry {
  file: string;
  sha256: string;
}

export interface PackageIdentity {
  name: string;
  version: string;
}

/**
 * Renders the `sha256sum` output format: `<hash><two spaces><name>`.
 *
 * We write and verify this file ourselves rather than shelling out, because the
 * available checksum tool differs on every platform the release matrix touches:
 * Alpine's BusyBox `sha256sum` accepts only `-c` (not `--check`), macOS ships no
 * `sha256sum` at all, and Windows has whatever Git for Windows bundles.
 */
export function formatChecksums(entries: readonly ChecksumEntry[]): string {
  return entries.map((entry) => `${entry.sha256}  ${entry.file}\n`).join("");
}

/** Accepts both the text (`  `) and binary (` *`) separators. */
export function parseChecksums(text: string): ChecksumEntry[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
      const sha256 = match?.[1];
      const file = match?.[2];
      if (sha256 == null || file == null) {
        throw new Error(`Malformed ${checksumFileName} line: ${line}`);
      }
      return { sha256, file };
    });
}

export async function writeChecksums(
  directory: string,
  files: readonly string[],
): Promise<ChecksumEntry[]> {
  const entries: ChecksumEntry[] = [];
  for (const file of files) {
    entries.push({ file, sha256: await sha256File(join(directory, file)) });
  }
  await writeFile(join(directory, checksumFileName), formatChecksums(entries));
  return entries;
}

/**
 * Rehashes every file listed in `SHA256SUMS`, throwing on the first mismatch.
 */
export async function verifyChecksums(
  directory: string,
): Promise<ChecksumEntry[]> {
  const entries = parseChecksums(
    await readFile(join(directory, checksumFileName), "utf8"),
  );
  if (entries.length === 0) {
    throw new Error(`${checksumFileName} lists no files`);
  }
  for (const entry of entries) {
    const actual = await sha256File(join(directory, entry.file));
    if (actual !== entry.sha256) {
      throw new Error(
        `${entry.file} is ${actual}, but ${checksumFileName} expects ${entry.sha256}`,
      );
    }
  }
  return entries;
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
