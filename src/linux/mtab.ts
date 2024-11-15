// src/linux/mtab.ts

import {
  decodeEscapeSequences,
  encodeEscapeSequences,
  isBlank,
} from "../string.js";

export interface MountEntry {
  fs_spec: string; // device or remote filesystem
  fs_file: string; // mount point
  fs_vfstype: string; // filesystem type
  fs_mntops: string; // mount options
  fs_freq: number; // dump frequency
  fs_passno: number; // fsck pass number
}

const NETWORK_FS_TYPES = new Set([
  "nfs",
  "nfs4",
  "cifs",
  "smb",
  "smbfs",
  "ncpfs",
  "afs",
  "afp",
  "ftp",
  "webdav",
]);

export function isRemoteFS(fstype: string): boolean {
  return NETWORK_FS_TYPES.has(fstype.toLowerCase());
}

export function parseRemoteInfo(device: string): {
  host?: string;
  share?: string;
} {
  const urlMatch = device.match(/^(\w+):\/\/([^/]+)(?:\/(.+))?$/);
  if (urlMatch) {
    return { host: urlMatch[2], share: urlMatch[3] };
  }

  const uncMatch = device.match(/^\/\/([^/]+)(?:\/(.+))?$/);
  if (uncMatch) {
    return { host: uncMatch[1], share: uncMatch[2] };
  }

  return {};
}

/**
 * Parses an mtab/fstab file content into structured mount entries
 * @param content - Raw content of the mtab/fstab file
 * @returns Array of parsed mount entries
 */
export function parseMtab(content: string): MountEntry[] {
  const entries: MountEntry[] = [];
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

    if (!fields || fields.length < 4) {
      continue; // Skip malformed lines
    }

    entries.push({
      fs_spec: fields[0],
      fs_file: normalizeLinuxMountPoint(fields[1] ?? ""),
      fs_vfstype: fields[2],
      fs_mntops: fields[3],
      fs_freq: parseInt(fields[4] || "0", 10),
      fs_passno: parseInt(fields[5] || "0", 10),
    });
  }

  return entries;
}

/**
 * Normalizes a Linux mount point by removing any trailing slashes. This is a
 * no-op for root mount points.
 */
export function normalizeLinuxMountPoint(mountPoint: string): string {
  return mountPoint.replace(/(?<=[^/])\/$/, "");
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
        entry.fs_freq.toString(),
        entry.fs_passno.toString(),
      ];
      return fields.join("\t");
    })
    .join("\n");
}
