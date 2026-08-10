import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { argv, env, execPath, platform } from "node:process";

import {
  assertPackedManifest,
  assertPackedPrebuilds,
  findTarball,
  packedFilename,
  type PackageIdentity,
} from "../src/release-package";

/**
 * Packs, verifies, installs, and loads the release tarball.
 *
 * Both `build.yml` and `publish.yaml` drive these subcommands, so the procedure
 * that gates a release is the same one every push to `main` exercises. Keeping
 * it here rather than in workflow shell also keeps it off the platform's
 * coreutils: the matrix spans GNU, BusyBox, macOS, and Git for Windows.
 */

function option(name: string): string {
  const index = argv.indexOf(`--${name}`);
  const value = argv[index + 1];
  if (index < 0 || value == null || value.startsWith("--")) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function optionalOption(name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index < 0 ? undefined : option(name);
}

/**
 * The identity every artifact must agree on. The release path passes
 * `--expected-*` so the tarball stays bound to the validated tag rather than to
 * whatever the checkout happens to say.
 */
async function identity(projectRoot: string): Promise<PackageIdentity> {
  const pkg = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  ) as { name?: unknown; version?: unknown };
  if (typeof pkg.name !== "string" || typeof pkg.version !== "string") {
    throw new Error("package.json must contain a name and version");
  }

  for (const [flag, actual] of [
    ["expected-name", pkg.name],
    ["expected-version", pkg.version],
  ] as const) {
    const expected = optionalOption(flag);
    if (expected != null && expected !== actual) {
      throw new Error(
        `--${flag} is ${expected}, but package.json says ${actual}`,
      );
    }
  }

  return { name: pkg.name, version: pkg.version };
}

/**
 * How to launch npm: `[command, ...prefixArgs]`.
 *
 * On Windows npm is `npm.cmd`, which Node refuses to spawn without a shell
 * (EINVAL, since the CVE-2024-27980 fix) -- and `shell: true` would hand
 * cmd.exe the tarball path unquoted. `npm_execpath` is npm's JavaScript entry
 * point, which node runs directly. Both workflows invoke this script through
 * `npm run`, so it is always set there.
 */
function npmArgv(): string[] {
  const execpath = env["npm_execpath"];
  if (execpath?.endsWith(".js") === true) return [execPath, execpath];
  if (platform === "win32") {
    throw new Error(
      "npm_execpath is unset, and node cannot spawn npm.cmd directly. Run this script through `npm run`.",
    );
  }
  return ["npm"]; // a shebang script execFile can launch
}

function npm(args: readonly string[], cwd: string): string {
  const [command, ...prefixArgs] = npmArgv() as [string, ...string[]];
  return execFileSync(command, [...prefixArgs, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function tar(args: readonly string[]): string {
  return execFileSync("tar", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function pack(projectRoot: string): Promise<void> {
  const artifactDir = resolve(option("artifact-dir"));
  const expected = await identity(projectRoot);
  await mkdir(artifactDir, { recursive: true });

  const packJson = npm(
    ["pack", "--json", "--ignore-scripts", "--pack-destination", artifactDir],
    projectRoot,
  );
  await writeFile(join(artifactDir, "PACK.json"), packJson);

  const filename = packedFilename(JSON.parse(packJson) as unknown, expected);
  const tarball = await findTarball(artifactDir);
  if (basename(tarball) !== filename) {
    throw new Error(
      `npm pack reported ${filename}, but ${basename(tarball)} is the only tarball`,
    );
  }

  assertPackedManifest(
    JSON.parse(tar(["-xOf", tarball, "package/package.json"])) as unknown,
    expected,
  );

  const contents = tar(["-tzf", tarball])
    .split("\n")
    .filter((line) => line.length > 0)
    .sort();
  assertPackedPrebuilds(contents, expected.name);
  await writeFile(
    join(artifactDir, "CONTENTS.txt"),
    contents.map((line) => `${line}\n`).join(""),
  );

  console.log(`Packed ${expected.name}@${expected.version} as ${filename}`);
}

async function install(): Promise<void> {
  const artifactDir = resolve(option("artifact-dir"));
  const installRoot = resolve(option("install-root"));

  const tarball = await findTarball(artifactDir);
  await mkdir(installRoot, { recursive: true });
  npm(["init", "--yes"], installRoot);
  npm(
    [
      "install",
      tarball,
      "--ignore-scripts",
      // Reject a tarball whose dependencies are too fresh to have been vetted.
      "--min-release-age=14",
      "--no-audit",
      "--no-fund",
    ],
    installRoot,
  );
  console.log(`Installed ${basename(tarball)} into ${installRoot}`);
}

interface FsMetadataModule {
  getVolumeMetadataForPath(path: string): Promise<{ size?: unknown }>;
}

async function load(projectRoot: string): Promise<void> {
  const installRoot = resolve(option("install-root"));
  const { name } = await identity(projectRoot);
  const requireFromInstall = createRequire(join(installRoot, "package.json"));

  const cjs = requireFromInstall(name) as FsMetadataModule;
  const metadata = await cjs.getVolumeMetadataForPath(installRoot);
  if (typeof metadata.size !== "number") {
    throw new Error(
      "Packed module did not return numeric volume size metadata",
    );
  }

  execFileSync(
    execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import * as fsMetadata from ${JSON.stringify(name)};
        const metadata = await fsMetadata.getVolumeMetadataForPath(process.cwd());
        if (typeof metadata.size !== "number") {
          throw new Error("Packed ESM export did not return numeric volume size metadata");
        }
      `,
    ],
    { cwd: installRoot, stdio: "inherit" },
  );

  console.log("Packed CommonJS and ESM entry points loaded successfully");
}

async function main(): Promise<void> {
  const command = argv[2];
  const projectRoot = resolve(option("project-root"));

  if (command === "pack") return pack(projectRoot);
  if (command === "install") return install();
  if (command === "load") return load(projectRoot);

  throw new Error(`Unsupported command: ${String(command)}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
