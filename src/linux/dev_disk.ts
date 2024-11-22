import { Dirent } from "node:fs";
import { readdir, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { decodeEscapeSequences } from "../string.js";

/**
 * Gets the UUID from symlinks for a given device path asynchronously
 * @param devicePath The device path to look up
 * @returns Promise that resolves to the UUID if found, empty string otherwise
 */
export function getUuidFromDevDisk(devicePath: string) {
  return getBasenameLinkedTo("/dev/disk/by-uuid", resolve(devicePath)).catch(
    () => undefined,
  );
}

/**
 * Gets the label from symlinks for a given device path asynchronously
 * @param devicePath The device path to look up
 * @returns Promise that resolves to the label if found, empty string otherwise
 */
export function getLabelFromDevDisk(devicePath: string) {
  return getBasenameLinkedTo("/dev/disk/by-label", resolve(devicePath)).catch(
    () => undefined,
  );
}

// only exposed for tests
export async function getBasenameLinkedTo(
  linkDir: string,
  linkPath: string,
): Promise<string | undefined> {
  for await (const ea of readLinks(linkDir)) {
    if (ea.linkTarget === linkPath) {
      // Expect the symlink to be named like '1tb\x20\x28test\x29'
      return decodeEscapeSequences(ea.dirent.name);
    }
  }
  return;
}

async function* readLinks(
  directory: string,
): AsyncGenerator<{ dirent: Dirent; linkTarget: string }, void, unknown> {
  for (const dirent of await readdir(directory, { withFileTypes: true })) {
    if (dirent.isSymbolicLink()) {
      try {
        const linkTarget = resolve(
          directory,
          await readlink(join(directory, dirent.name)),
        );
        yield { dirent, linkTarget };
      } catch {
        // Ignore errors
      }
    }
  }
}
