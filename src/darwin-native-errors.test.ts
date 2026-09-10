import { constants } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { types } from "node:util";
import {
  getMountPointForPath,
  getVolumeMetadata,
  getVolumeMetadataForPath,
} from "./index";
import { isMacOS } from "./platform";

(isMacOS ? describe : describe.skip)("macOS native system errors", () => {
  let scratch: string;
  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "fs-metadata-errors-"));
  });
  afterAll(async () => {
    if (scratch)
      await rm(scratch, { recursive: true, force: true, maxRetries: 1 });
  });

  // Ground truth: Node's filesystem errors on the same macOS host.
  // node -e 'require("node:fs/promises").realpath("/fs-metadata-review-missing-92f88058").catch(console.log)'
  // node -e 'require("node:fs/promises").open("/etc/hosts", require("node:fs").constants.O_DIRECTORY).catch(console.log)'
  // These report negative errno, the failed syscall, and its path. Compare
  // against Node on the test fixture too, rather than hardcoding errno values.
  async function systemError(operation: Promise<unknown>) {
    const error: unknown = await operation.catch((cause: unknown) => cause);
    expect(types.isNativeError(error)).toBe(true);
    const { code, errno, syscall, path } = error as NodeJS.ErrnoException;
    expect(code).toEqual(expect.any(String));
    expect(errno).toEqual(expect.any(Number));
    expect(syscall).toEqual(expect.any(String));
    expect(path).toEqual(expect.any(String));
    return { code, errno, syscall, path };
  }

  it.each([
    ["getMountPointForPath", getMountPointForPath],
    ["getVolumeMetadataForPath", getVolumeMetadataForPath],
    ["getVolumeMetadata", getVolumeMetadata],
  ] as const)(
    "%s preserves realpath error properties",
    async (_name, query) => {
      const missing = join(scratch, "missing");
      expect(await systemError(query(missing))).toEqual(
        await systemError(realpath(missing)),
      );
    },
  );

  it("preserves directory-open error properties", async () => {
    const file = join(scratch, "file");
    await writeFile(file, "fixture");
    expect(await systemError(getVolumeMetadata(file))).toEqual(
      await systemError(open(file, constants.O_DIRECTORY)),
    );
  });

  it("preserves the caller's path through a directory symlink", async () => {
    // The Node open('/etc/hosts') reference command above also pins this:
    // /etc is a symlink on macOS, but the error's path remains '/etc/hosts'.
    const target = join(scratch, "target");
    await mkdir(target);
    const alias = join(scratch, "alias");
    await symlink(await realpath(target), alias);
    const file = join(alias, "file");
    await writeFile(file, "fixture");
    expect(await systemError(getVolumeMetadata(file))).toEqual(
      await systemError(open(file, constants.O_DIRECTORY)),
    );
  });
});
