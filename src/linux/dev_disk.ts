import { Dirent } from "node:fs";
import { readdir, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";

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

async function getBasenameLinkedTo(
  linkDir: string,
  linkPath: string,
): Promise<string | undefined> {
  for await (const ea of readLinks(linkDir)) {
    if (ea.linkTarget === linkPath) {
      return ea.dirent.name;
    }
  }
  return;
}

// only exposed for test mocking
export async function* readLinks(
  directory: string,
): AsyncGenerator<{ dirent: Dirent; linkTarget: string }, void, unknown> {
  for (const dirent of await readdir(directory, { withFileTypes: true })) {
    if (dirent.isSymbolicLink()) {
      try {
        const linkTarget = resolve(
          await readlink(join(directory, dirent.name)),
        );
        yield { dirent, linkTarget };
      } catch {
        // Ignore errors
      }
    }
  }
}
