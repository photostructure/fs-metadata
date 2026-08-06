import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertPackedManifest,
  checksumFileName,
  findTarball,
  formatChecksums,
  packedFilename,
  parseChecksums,
  verifyChecksums,
  writeChecksums,
} from "./release-package";

describe("release package", () => {
  const identity = { name: "@photostructure/fs-metadata", version: "9.9.9" };
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

  describe("checksums", () => {
    test("writes the sha256sum text format", async () => {
      await writeFile(join(tempRoot, "a.tgz"), "hello");
      const entries = await writeChecksums(tempRoot, ["a.tgz"]);

      expect(entries).toEqual([
        {
          file: "a.tgz",
          sha256:
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
      ]);
      expect(formatChecksums(entries)).toBe(
        `${entries[0]!.sha256}  a.tgz\n`, // two spaces, as GNU coreutils writes
      );
    });

    test("round-trips what it writes", async () => {
      await writeFile(join(tempRoot, "a.tgz"), "hello");
      const written = await writeChecksums(tempRoot, ["a.tgz"]);
      expect(await verifyChecksums(tempRoot)).toEqual(written);
    });

    test("accepts the binary-mode separator", () => {
      const hash = "0".repeat(64);
      expect(parseChecksums(`${hash} *a.tgz\n`)).toEqual([
        { file: "a.tgz", sha256: hash },
      ]);
    });

    test("rejects a malformed line", () => {
      expect(() => parseChecksums("not-a-checksum\n")).toThrow(
        /Malformed SHA256SUMS line/,
      );
    });

    test("rejects an empty checksum file", async () => {
      await writeFile(join(tempRoot, checksumFileName), "\n");
      await expect(verifyChecksums(tempRoot)).rejects.toThrow(/lists no files/);
    });

    test("rejects altered content", async () => {
      await writeFile(join(tempRoot, "a.tgz"), "hello");
      await writeChecksums(tempRoot, ["a.tgz"]);
      await writeFile(join(tempRoot, "a.tgz"), "tampered");

      await expect(verifyChecksums(tempRoot)).rejects.toThrow(
        /a\.tgz is [0-9a-f]{64}, but SHA256SUMS expects/,
      );
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

  describe("findTarball", () => {
    test("returns the only tarball", async () => {
      await writeFile(join(tempRoot, "a.tgz"), "");
      await writeFile(join(tempRoot, checksumFileName), "");
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
