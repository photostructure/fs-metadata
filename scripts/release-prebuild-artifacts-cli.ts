import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { argv } from "node:process";

import { verifyPrebuilds } from "../src/release-prebuild-artifacts";

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
  if (command !== "verify") {
    throw new Error(`Unsupported command: ${String(command)}`);
  }

  const projectRoot = resolve(option("project-root"));
  const files = await verifyPrebuilds({
    projectRoot,
    packageName: await packageName(projectRoot),
  });
  console.log(`Verified exactly ${files.length} release prebuilds`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
