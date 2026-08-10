import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertPackedManifest,
  assertPackedPrebuilds,
  findTarball,
  packedFilename,
} from "./release-package";
import {
  expectedPrebuildPath,
  prebuildTargets,
} from "./release-prebuild-artifacts";

describe("release package", () => {
  const identity = { name: "@photostructure/fs-metadata", version: "9.9.9" };
  const packedPrebuilds = prebuildTargets.map(
    (target) => `package/${expectedPrebuildPath(identity.name, target)}`,
  );
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "fs-metadata-package-test-"));
  });

  afterEach(async () => {
    await rm(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 3 : 1,
      retryDelay: process.platform === "win32" ? 100 : 0,
    });
  });

  describe("identity", () => {
    test("returns the packed filename npm reports", () => {
      expect(
        packedFilename(
          [{ ...identity, filename: "photostructure-fs-metadata-9.9.9.tgz" }],
          identity,
        ),
      ).toBe("photostructure-fs-metadata-9.9.9.tgz");
    });

    test("rejects a pack record for another version", () => {
      expect(() =>
        packedFilename(
          [{ ...identity, version: "1.0.0", filename: "x.tgz" }],
          identity,
        ),
      ).toThrow(/identifies @photostructure\/fs-metadata@1\.0\.0/);
    });

    test("rejects more than one pack record", () => {
      expect(() => packedFilename([{}, {}], identity)).toThrow(
        /Expected one npm pack record, found 2/,
      );
    });

    test("rejects a packed manifest for another package", () => {
      expect(() =>
        assertPackedManifest({ ...identity, name: "other" }, identity),
      ).toThrow(/The packed manifest identifies other@9\.9\.9/);
    });
  });

  describe("packed prebuilds", () => {
    test("accepts every expected binary exactly once", () => {
      expect(() =>
        assertPackedPrebuilds(
          ["package/package.json", ...packedPrebuilds],
          identity.name,
        ),
      ).not.toThrow();
    });

    test("rejects a missing expected binary", () => {
      expect(() =>
        assertPackedPrebuilds(packedPrebuilds.slice(1), identity.name),
      ).toThrow(`Missing: ${packedPrebuilds[0]}`);
    });

    test("rejects a duplicate expected binary", () => {
      expect(() =>
        assertPackedPrebuilds(
          [...packedPrebuilds, packedPrebuilds[0]!],
          identity.name,
        ),
      ).toThrow(`Unexpected: ${packedPrebuilds[0]}`);
    });

    test("rejects an unexpected native binary", () => {
      const unexpected = "package/prebuilds/linux-x64/unexpected.node";
      expect(() =>
        assertPackedPrebuilds([...packedPrebuilds, unexpected], identity.name),
      ).toThrow(`Unexpected: ${unexpected}`);
    });
  });

  describe("findTarball", () => {
    test("returns the only tarball", async () => {
      await writeFile(join(tempRoot, "a.tgz"), "");
      expect(await findTarball(tempRoot)).toBe(join(tempRoot, "a.tgz"));
    });

    test("rejects an ambiguous directory", async () => {
      await writeFile(join(tempRoot, "a.tgz"), "");
      await writeFile(join(tempRoot, "b.tgz"), "");
      await expect(findTarball(tempRoot)).rejects.toThrow(
        /Expected exactly one tarball/,
      );
    });

    test("rejects a directory with no tarball", async () => {
      await expect(findTarball(tempRoot)).rejects.toThrow(/found none/);
    });
  });
});
