// src/linux/dev_disk.ts

import { Dirent } from "node:fs";
import { readdir, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { debug } from "../debuglog";
import { decodeEscapeSequences } from "../string";

/**
 * Gets the UUID from symlinks for a given device path asynchronously
 * @param devicePath The device path to look up
 * @returns Promise that resolves to the UUID if found, empty string otherwise
 */
export async function getUuidFromDevDisk(devicePath: string) {
  try {
    const result = await getBasenameLinkedTo(
      "/dev/disk/by-uuid",
      resolve(devicePath),
    );
    debug("[getUuidFromDevDisk] result: %o", result);
    return result;
  } catch (error) {
    debug("[getUuidFromDevDisk] failed: " + error);
    return;
  }
}

/**
 * Gets the label from symlinks for a given device path asynchronously
 * @param devicePath The device path to look up
 * @returns Promise that resolves to the label if found, empty string otherwise
 */
export async function getLabelFromDevDisk(devicePath: string) {
  try {
    const result = await getBasenameLinkedTo(
      "/dev/disk/by-label",
      resolve(devicePath),
    );
    debug("[getLabelFromDevDisk] result: %o", result);
    return result;
  } catch (error) {
    debug("[getLabelFromDevDisk] failed: " + error);
    return;
  }
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
