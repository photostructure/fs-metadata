import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  expectedPrebuildPath,
  packagePrebuild,
  prebuildifyArgs,
  prebuildTargets,
  targetId,
  verifyAndAssemblePrebuilds,
} from "./release-prebuild-artifacts";

describe("release prebuild artifacts", () => {
  let tempRoot: string;

  async function populateAggregate(
    aggregateRoot: string,
    packageName: string,
  ): Promise<void> {
    const sourceRoot = join(tempRoot, "source");

    for (const target of prebuildTargets) {
      const projectRoot = join(sourceRoot, targetId(target));
      const artifactRoot = join(tempRoot, "artifact", targetId(target));
      const relativeFile = expectedPrebuildPath(packageName, target);
      const binary = Buffer.from(`binary:${targetId(target)}`);
      await mkdir(dirname(join(projectRoot, relativeFile)), {
        recursive: true,
      });
      await writeFile(join(projectRoot, relativeFile), binary);

      await packagePrebuild({ projectRoot, artifactRoot, packageName, target });

      const manifestPath = join(
        aggregateRoot,
        "prebuild-manifests",
        `${targetId(target)}.json`,
      );
      const aggregateBinary = join(aggregateRoot, relativeFile);
      await mkdir(dirname(manifestPath), { recursive: true });
      await mkdir(dirname(aggregateBinary), { recursive: true });
      await writeFile(
        manifestPath,
        await readFile(
          join(artifactRoot, "prebuild-manifests", `${targetId(target)}.json`),
        ),
      );
      await writeFile(aggregateBinary, binary);
    }
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "fs-metadata-release-test-"));
  });

  afterEach(async () => {
    await rm(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 3 : 1,
      retryDelay: process.platform === "win32" ? 100 : 0,
    });
  });

  test("uses the prebuildify package filenames for every release target", () => {
    expect(
      prebuildTargets.map((target) =>
        expectedPrebuildPath("@photostructure/fs-metadata", target),
      ),
    ).toEqual([
      "prebuilds/darwin-x64/@photostructure+fs-metadata.node",
      "prebuilds/darwin-arm64/@photostructure+fs-metadata.node",
      "prebuilds/win32-x64/@photostructure+fs-metadata.node",
      "prebuilds/win32-arm64/@photostructure+fs-metadata.node",
      "prebuilds/linux-x64/@photostructure+fs-metadata.glibc.node",
      "prebuilds/linux-arm64/@photostructure+fs-metadata.glibc.node",
      "prebuilds/linux-x64/@photostructure+fs-metadata.musl.node",
      "prebuilds/linux-arm64/@photostructure+fs-metadata.musl.node",
    ]);
  });

  test("tags libc in the build flags exactly where the expected filename does", () => {
    for (const target of prebuildTargets) {
      const args = prebuildifyArgs(target);
      const file = expectedPrebuildPath("@photostructure/fs-metadata", target);
      expect([targetId(target), args.includes("--tag-libc")]).toEqual([
        targetId(target),
        /\.(?:glibc|musl)\.node$/.test(file),
      ]);
      expect(args).toEqual(
        expect.arrayContaining([
          "--napi",
          "--strip",
          "--arch",
          target.architecture,
          "--platform",
          target.platform,
        ]),
      );
    }
  });

  test("packages, verifies, and assembles exactly eight checksummed prebuilds", async () => {
    const aggregateRoot = join(tempRoot, "aggregate");
    const destinationRoot = join(tempRoot, "assembled");
    const packageName = "@photostructure/fs-metadata";

    await populateAggregate(aggregateRoot, packageName);

    const manifests = await verifyAndAssemblePrebuilds({
      sourceRoot: aggregateRoot,
      destinationRoot,
      packageName,
    });

    expect(manifests).toHaveLength(8);
    for (const manifest of manifests) {
      const assembled = await readFile(
        join(destinationRoot, manifest.file.replace(/^prebuilds\//, "")),
      );
      expect(createHash("sha256").update(assembled).digest("hex")).toBe(
        manifest.sha256,
      );
    }
  });

  test("rejects an unexpected manifest", async () => {
    const aggregateRoot = join(tempRoot, "aggregate");
    const packageName = "@photostructure/fs-metadata";
    await populateAggregate(aggregateRoot, packageName);
    await writeFile(
      join(aggregateRoot, "prebuild-manifests", "unexpected.json"),
      "{}\n",
    );

    await expect(
      verifyAndAssemblePrebuilds({
        sourceRoot: aggregateRoot,
        destinationRoot: join(tempRoot, "assembled"),
        packageName,
      }),
    ).rejects.toThrow("Manifest set mismatch");
  });

  test("rejects an unexpected native binary", async () => {
    const projectRoot = join(tempRoot, "project");
    const expected = expectedPrebuildPath(
      "@photostructure/fs-metadata",
      prebuildTargets[0],
    );
    await mkdir(dirname(join(projectRoot, expected)), { recursive: true });
    await writeFile(join(projectRoot, expected), "expected");
    await writeFile(
      join(projectRoot, "prebuilds/darwin-x64/unexpected.node"),
      "bad",
    );

    await expect(
      packagePrebuild({
        projectRoot,
        artifactRoot: join(tempRoot, "artifact"),
        packageName: "@photostructure/fs-metadata",
        target: prebuildTargets[0],
      }),
    ).rejects.toThrow("Expected only");
  });
});
