import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { argv, execPath } from "node:process";

interface FsMetadataModule {
  getVolumeMetadataForPath(path: string): Promise<{ size?: unknown }>;
}

async function verifyModule(
  module: FsMetadataModule,
  path: string,
): Promise<void> {
  const metadata = await module.getVolumeMetadataForPath(path);
  if (typeof metadata.size !== "number") {
    throw new Error(
      "Packed module did not return numeric volume size metadata",
    );
  }
}

async function main(): Promise<void> {
  const smokeRoot = argv[2];
  if (smokeRoot == null) {
    throw new Error("Expected the package smoke-test directory");
  }

  const absoluteRoot = resolve(smokeRoot);
  const requireFromSmoke = createRequire(resolve(absoluteRoot, "package.json"));
  const cjs = requireFromSmoke(
    "@photostructure/fs-metadata",
  ) as FsMetadataModule;
  await verifyModule(cjs, absoluteRoot);

  execFileSync(
    execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import * as fsMetadata from "@photostructure/fs-metadata";
        const metadata = await fsMetadata.getVolumeMetadataForPath(process.cwd());
        if (typeof metadata.size !== "number") {
          throw new Error("Packed ESM export did not return numeric volume size metadata");
        }
      `,
    ],
    { cwd: absoluteRoot, stdio: "inherit" },
  );

  console.log("Packed CommonJS and ESM entry points loaded successfully");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
