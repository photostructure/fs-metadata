// src/linux/mtab.ts

import { toInt } from "../number";
import { normalizePosixPath } from "../path";
import { extractRemoteInfo } from "../remote_info";
import {
  decodeEscapeSequences,
  encodeEscapeSequences,
  isBlank,
  toNotBlank,
} from "../string";
import { isSystemVolume, SystemVolumeConfig } from "../system_volume";
import type { MountPoint } from "../types/mount_point";
import type { VolumeMetadata } from "../types/volume_metadata";

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
  fs_mntops: string | undefined;
  /**
   * Dump frequency
   */
  fs_freq: number | undefined;
  /**
   * fsck pass number
   */
  fs_passno: number | undefined;
}

export function mountEntryToMountPoint(
  entry: MountEntry,
): MountPoint | undefined {
  const mountPoint = normalizePosixPath(entry.fs_file);
  const fstype = toNotBlank(entry.fs_vfstype) ?? toNotBlank(entry.fs_spec);
  return mountPoint == null || fstype == null
    ? undefined
    : {
        mountPoint,
        fstype,
      };
}

export type MtabVolumeMetadata = Omit<
  VolumeMetadata,
  "size" | "used" | "available" | "label" | "uuid" | "status"
>;

export function mountEntryToPartialVolumeMetadata(
  entry: MountEntry,
  options: Partial<SystemVolumeConfig> = {},
): MtabVolumeMetadata {
  return {
    mountPoint: entry.fs_file,
    fstype: entry.fs_vfstype,
    mountFrom: entry.fs_spec,
    isSystemVolume: isSystemVolume(entry.fs_file, entry.fs_vfstype, options),
    remote: false, // < default to false, but it may be overridden by extractRemoteInfo
    ...extractRemoteInfo(entry.fs_spec),
  };
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
      .match(/(?:[^\s\\]|\\.)+/g)
      ?.map(decodeEscapeSequences);

    if (!fields || fields.length < 3) {
      continue; // Skip malformed lines
    }
    const fs_file = normalizePosixPath(fields[1]);
    if (fs_file != null) {
      entries.push({
        fs_spec: fields[0] as string,
        // normalizeLinuxPath DOES NOT resolve()!
        fs_file,
        fs_vfstype: fields[2] as string,
        fs_mntops: fields[3],
        fs_freq: toInt(fields[4]),
        fs_passno: toInt(fields[5]),
      });
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
