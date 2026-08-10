import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

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
}

interface VerifyPrebuildsOptions {
  projectRoot: string;
  packageName: string;
}

function slashPath(path: string): string {
  return path.split(sep).join("/");
}

export function expectedPrebuildPath(
  packageName: string,
  target: PrebuildTarget,
): string {
  const binaryName = packageName.replaceAll("/", "+");
  const libcSuffix = target.libc == null ? "" : `.${target.libc}`;
  return `prebuilds/${target.platform}-${target.architecture}/${binaryName}${libcSuffix}.node`;
}

export function expectedPrebuildPaths(packageName: string): string[] {
  return prebuildTargets
    .map((target) => expectedPrebuildPath(packageName, target))
    .sort();
}

/**
 * Arguments for `prebuildify` that produce {@link expectedPrebuildPath} for the
 * host platform.
 *
 * `--tag-libc` is Linux-only on purpose: it is what separates the glibc and
 * musl builds that share `prebuilds/linux-<arch>/`. prebuildify honors the flag
 * on every platform, so passing it unconditionally emits a nonsensical
 * `...glibc.node` on macOS and Windows.
 */
export function prebuildifyArgs(target: PrebuildTargetIdentity): string[] {
  return [
    "--napi",
    ...(target.platform === "linux" ? ["--tag-libc"] : []),
    "--strip",
    "--arch",
    target.architecture,
    "--platform",
    target.platform,
  ];
}

/** Rejects missing, duplicate, and unexpected paths with deterministic errors. */
export function assertExactFileSet(
  actualFiles: readonly string[],
  expectedFiles: readonly string[],
  source: string,
): void {
  const remaining = new Map<string, number>();
  for (const file of expectedFiles) {
    remaining.set(file, (remaining.get(file) ?? 0) + 1);
  }

  const unexpected: string[] = [];
  for (const file of actualFiles) {
    const count = remaining.get(file) ?? 0;
    if (count === 0) unexpected.push(file);
    else remaining.set(file, count - 1);
  }

  const missing: string[] = [];
  for (const [file, count] of remaining) {
    for (let index = 0; index < count; index += 1) missing.push(file);
  }

  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      ...(missing.length === 0
        ? []
        : [`Missing: ${missing.sort().join(", ")}`]),
      ...(unexpected.length === 0
        ? []
        : [`Unexpected: ${unexpected.sort().join(", ")}`]),
    ];
    throw new Error(`${source} mismatch. ${details.join(". ")}`);
  }
}

async function findRegularFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = slashPath(relative(root, path));
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        found.push(relativePath);
      } else {
        throw new Error(
          `Unexpected: prebuilds/${relativePath} is not a regular file`,
        );
      }
    }
  }

  await visit(root);
  return found.sort();
}

/** Verifies that `prebuilds/` contains exactly the release's eight binaries. */
export async function verifyPrebuilds({
  projectRoot,
  packageName,
}: VerifyPrebuildsOptions): Promise<string[]> {
  const prebuildRoot = join(resolve(projectRoot), "prebuilds");
  let actualFiles: string[];
  try {
    actualFiles = (await findRegularFiles(prebuildRoot)).map(
      (file) => `prebuilds/${file}`,
    );
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Prebuild directory ${prebuildRoot} does not exist`, {
        cause: error,
      });
    }
    throw error;
  }

  const expectedFiles = expectedPrebuildPaths(packageName);
  assertExactFileSet(actualFiles, expectedFiles, "Prebuild set");
  return actualFiles;
}
