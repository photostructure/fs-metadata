import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { argv } from "node:process";

import {
  packagePrebuild,
  prebuildTargets,
  targetId,
  verifyAndAssemblePrebuilds,
} from "../src/release-prebuild-artifacts";

function option(name: string): string {
  const index = argv.indexOf(`--${name}`);
  const value = argv[index + 1];
  if (index < 0 || value == null || value.startsWith("--")) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

async function packageName(projectRoot: string): Promise<string> {
  const pkg = JSON.parse(
    await readFile(resolve(projectRoot, "package.json"), "utf8"),
  ) as { name?: unknown };
  if (typeof pkg.name !== "string" || pkg.name.length === 0) {
    throw new Error("package.json must contain a package name");
  }
  return pkg.name;
}

async function main(): Promise<void> {
  const command = argv[2];
  const projectRoot = resolve(option("project-root"));
  const name = await packageName(projectRoot);

  if (command === "package") {
    const id = option("target");
    const target = prebuildTargets.find(
      (candidate) => targetId(candidate) === id,
    );
    if (target == null) {
      throw new Error(`Unsupported prebuild target: ${id}`);
    }
    const manifest = await packagePrebuild({
      projectRoot,
      artifactRoot: resolve(option("artifact-root")),
      packageName: name,
      target,
    });
    console.log(JSON.stringify(manifest));
    return;
  }

  if (command === "assemble") {
    const manifests = await verifyAndAssemblePrebuilds({
      sourceRoot: resolve(option("source-root")),
      destinationRoot: resolve(option("destination-root")),
      packageName: name,
    });
    console.log(JSON.stringify(manifests, null, 2));
    return;
  }

  throw new Error(`Unsupported command: ${String(command)}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
