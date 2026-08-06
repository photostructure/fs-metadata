import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export const prebuildTargets = [
  { platform: "darwin", architecture: "x64", libc: null },
  { platform: "darwin", architecture: "arm64", libc: null },
  { platform: "win32", architecture: "x64", libc: null },
  { platform: "win32", architecture: "arm64", libc: null },
  { platform: "linux", architecture: "x64", libc: "glibc" },
  { platform: "linux", architecture: "arm64", libc: "glibc" },
  { platform: "linux", architecture: "x64", libc: "musl" },
  { platform: "linux", architecture: "arm64", libc: "musl" },
] as const;

export type PrebuildTarget = (typeof prebuildTargets)[number];

interface PrebuildTargetIdentity {
  platform: string;
  architecture: string;
  libc: string | null;
}

export interface PrebuildManifest {
  schemaVersion: 1;
  packageName: string;
  platform: PrebuildTarget["platform"];
  architecture: PrebuildTarget["architecture"];
  libc: PrebuildTarget["libc"];
  abi: "napi-v9";
  file: string;
  sha256: string;
}

interface PackagePrebuildOptions {
  projectRoot: string;
  artifactRoot: string;
  packageName: string;
  target: PrebuildTarget;
}

interface AssemblePrebuildsOptions {
  sourceRoot: string;
  destinationRoot: string;
  packageName: string;
}

function slashPath(path: string): string {
  return path.split(sep).join("/");
}

export function targetId(target: PrebuildTargetIdentity): string {
  return [target.platform, target.architecture, target.libc]
    .filter((part) => part != null)
    .join("-");
}

export function expectedPrebuildPath(
  packageName: string,
  target: PrebuildTarget,
): string {
  const binaryName = packageName.replaceAll("/", "+");
  const libcSuffix = target.libc == null ? "" : `.${target.libc}`;
  return `prebuilds/${target.platform}-${target.architecture}/${binaryName}${libcSuffix}.node`;
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function findFiles(root: string, suffix: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        found.push(slashPath(relative(root, path)));
      }
    }
  }

  await visit(root);
  return found.sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function parseManifest(
  value: unknown,
  expected: PrebuildManifest,
): PrebuildManifest {
  if (!isRecord(value)) {
    throw new Error(`Manifest ${targetId(expected)} is not a JSON object`);
  }

  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw new Error(
        `Manifest ${targetId(expected)} has invalid ${field}: ${String(value[field])}`,
      );
    }
  }

  return value as unknown as PrebuildManifest;
}

export async function packagePrebuild({
  projectRoot,
  artifactRoot,
  packageName,
  target,
}: PackagePrebuildOptions): Promise<PrebuildManifest> {
  const expectedFile = expectedPrebuildPath(packageName, target);
  const prebuildRoot = join(resolve(projectRoot), "prebuilds");
  const nodeFiles = await findFiles(prebuildRoot, ".node");
  const expectedFromPrebuildRoot = expectedFile.replace(/^prebuilds\//, "");

  if (nodeFiles.length !== 1 || nodeFiles[0] !== expectedFromPrebuildRoot) {
    throw new Error(
      `Expected only ${expectedFile}; found ${nodeFiles.join(", ") || "no prebuilds"}`,
    );
  }

  const source = join(projectRoot, expectedFile);
  const manifest: PrebuildManifest = {
    schemaVersion: 1,
    packageName,
    platform: target.platform,
    architecture: target.architecture,
    libc: target.libc,
    abi: "napi-v9",
    file: expectedFile,
    sha256: await sha256(source),
  };
  const destination = join(artifactRoot, expectedFile);
  const manifestPath = join(
    artifactRoot,
    "prebuild-manifests",
    `${targetId(target)}.json`,
  );

  await mkdir(dirname(destination), { recursive: true });
  await mkdir(dirname(manifestPath), { recursive: true });
  await copyFile(source, destination);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

export async function verifyAndAssemblePrebuilds({
  sourceRoot,
  destinationRoot,
  packageName,
}: AssemblePrebuildsOptions): Promise<PrebuildManifest[]> {
  const manifests: PrebuildManifest[] = [];
  const manifestRoot = join(sourceRoot, "prebuild-manifests");
  const actualManifestFiles = await findFiles(manifestRoot, ".json");
  const expectedManifestFiles = prebuildTargets
    .map((target) => `${targetId(target)}.json`)
    .sort();

  if (
    JSON.stringify(actualManifestFiles) !==
    JSON.stringify(expectedManifestFiles)
  ) {
    throw new Error(
      `Manifest set mismatch: expected ${expectedManifestFiles.join(", ")}; found ${actualManifestFiles.join(", ")}`,
    );
  }

  for (const target of prebuildTargets) {
    const file = expectedPrebuildPath(packageName, target);
    const manifestPath = join(manifestRoot, `${targetId(target)}.json`);
    const checksum = await sha256(join(sourceRoot, file));
    const expected: PrebuildManifest = {
      schemaVersion: 1,
      packageName,
      platform: target.platform,
      architecture: target.architecture,
      libc: target.libc,
      abi: "napi-v9",
      file,
      sha256: checksum,
    };
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    manifests.push(parseManifest(parsed, expected));
  }

  const actualFiles = await findFiles(join(sourceRoot, "prebuilds"), ".node");
  const expectedFiles = manifests
    .map((manifest) => manifest.file.replace(/^prebuilds\//, ""))
    .sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `Prebuild set mismatch: expected ${expectedFiles.join(", ")}; found ${actualFiles.join(", ")}`,
    );
  }

  await rm(destinationRoot, { recursive: true, force: true });
  for (const manifest of manifests) {
    const source = join(sourceRoot, manifest.file);
    const destination = join(
      destinationRoot,
      manifest.file.replace(/^prebuilds\//, ""),
    );
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  return manifests;
}
