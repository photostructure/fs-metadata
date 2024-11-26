// src/linux/mtab.ts

import { toInt } from "../number.js";
import { normalizeLinuxPath } from "../path.js";
import {
  extractRemoteInfo,
  isRemoteFsType,
  RemoteInfo,
} from "../remote_info.js";
import {
  decodeEscapeSequences,
  encodeEscapeSequences,
  isBlank,
} from "../string.js";

/**
 * Represents an entry in the mount table.
 */
export interface MountEntry {
  /**
   * Device or remote filesystem
   */
  fs_spec: string;
  /**
   * Mount point
   */
  fs_file: string;
  /**
   * Filesystem type
   */
  fs_vfstype: string;
  /**
   * Mount options
   */
  fs_mntops: string;
  /**
   * Dump frequency
   */
  fs_freq: number | undefined;
  /**
   * fsck pass number
   */
  fs_passno: number | undefined;
}

/**
 * Parses an mtab/fstab file content into structured mount entries
 * @param content - Raw content of the mtab/fstab file
 * @returns Array of parsed mount entries
 */
export function parseMtab(
  content: string,
): (MountEntry | (MountEntry & RemoteInfo))[] {
  const entries: (MountEntry | (MountEntry & RemoteInfo))[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // Skip comments and empty lines
    if (isBlank(line) || line.trim().startsWith("#")) {
      continue;
    }

    const fields = line
      .trim()
      .match(/(?:[^\s\\]+|\\.)+/g)
      ?.map(decodeEscapeSequences);

    if (!fields || fields.length < 3) {
      continue; // Skip malformed lines
    }

    const entry: MountEntry = {
      fs_spec: fields[0]!,
      // normalizeLinuxPath DOES NOT resolve()!
      fs_file: normalizeLinuxPath(fields[1] ?? ""),
      fs_vfstype: fields[2]!,
      fs_mntops: fields[3]!,
      fs_freq: toInt(fields[4]),
      fs_passno: toInt(fields[5]),
    };

    const remoteInfo = isRemoteFsType(entry.fs_vfstype)
      ? extractRemoteInfo(entry.fs_spec)
      : undefined;
    if (remoteInfo) {
      entries.push({ ...entry, ...remoteInfo });
    } else {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Formats mount entries back into mtab file format
 * @param entries - Array of mount entries
 * @returns Formatted mtab file content
 */
export function formatMtab(entries: MountEntry[]): string {
  return entries
    .map((entry) => {
      const fields = [
        entry.fs_spec,
        encodeEscapeSequences(entry.fs_file),
        entry.fs_vfstype,
        entry.fs_mntops,
        entry.fs_freq?.toString(),
        entry.fs_passno?.toString(),
      ];
      return fields.join("\t");
    })
    .join("\n");
}
