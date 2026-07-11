// src/linux/mtab.ts

import { toInt } from "../number";
import { NetworkFsTypesDefault } from "../options";
import { normalizePosixPath } from "../path";
import { extractRemoteInfo, isRemoteFsType } from "../remote_info";
import {
  decodeMountTableEscapes,
  encodeEscapeSequences,
  isBlank,
  toNotBlank,
} from "../string";
import { isSystemVolume } from "../system_volume";
import type { MountPoint } from "../types/mount_point";
import type { Options } from "../types/options";
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

function isReadOnlyMount(fs_mntops: string | undefined): boolean {
  return fs_mntops?.split(",").includes("ro") ?? false;
}

/**
 * Extracts the btrfs subvolume discriminators from a mount options string.
 *
 * btrfs mounts carry `subvol=<path>` and `subvolid=<n>` in the options field
 * (never in the device/fs_spec field). These distinguish sibling subvolumes of
 * one filesystem that otherwise share a single libblkid fs UUID. Keys are only
 * included in the result when present, so the spread is a no-op for non-btrfs
 * mounts.
 *
 * Gated on `fstype === "btrfs"` so the fields stay `undefined` on every other
 * filesystem, honoring the btrfs-only contract in the public types even if some
 * unrelated mount happens to carry a `subvol=`-like option.
 */
function parseSubvolInfo(
  fs_mntops: string | undefined,
  fstype: string | undefined,
): {
  subvol?: string;
  subvolid?: number;
} {
  if (fstype !== "btrfs" || fs_mntops == null) return {};
  const result: { subvol?: string; subvolid?: number } = {};
  for (const opt of fs_mntops.split(",")) {
    const eq = opt.indexOf("=");
    if (eq < 0) continue;
    const key = opt.slice(0, eq);
    if (key === "subvol") {
      result.subvol = opt.slice(eq + 1);
    } else if (key === "subvolid") {
      const id = toInt(opt.slice(eq + 1));
      if (id != null) result.subvolid = id;
    }
  }
  return result;
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
        isReadOnly: isReadOnlyMount(entry.fs_mntops),
        ...parseSubvolInfo(entry.fs_mntops, entry.fs_vfstype),
      };
}

export type MtabVolumeMetadata = Omit<
  VolumeMetadata,
  "size" | "used" | "available" | "label" | "uuid" | "status"
>;

export type MtabOptions = Partial<
  Pick<Options, "systemPathPatterns" | "systemFsTypes" | "networkFsTypes">
>;

export function mountEntryToPartialVolumeMetadata(
  entry: MountEntry,
  options: MtabOptions = {},
): MtabVolumeMetadata {
  const networkFsTypes = options.networkFsTypes ?? NetworkFsTypesDefault;
  const remoteInfo = extractRemoteInfo(entry.fs_spec, networkFsTypes);
  return {
    mountPoint: entry.fs_file,
    fstype: entry.fs_vfstype,
    mountFrom: entry.fs_spec,
    isSystemVolume: isSystemVolume(entry.fs_file, entry.fs_vfstype, options),
    isReadOnly: isReadOnlyMount(entry.fs_mntops),
    ...parseSubvolInfo(entry.fs_mntops, entry.fs_vfstype),
    ...remoteInfo,
    // The spec alone can miss remote mounts — a network fstype with an
    // unparseable source (e.g. 9p's "svc", or davfs's https:// URI) must
    // still be marked remote, or skipNetworkVolumes would probe it.
    remote:
      (remoteInfo?.remote ?? false) ||
      isRemoteFsType(entry.fs_vfstype, networkFsTypes),
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
      ?.map(decodeMountTableEscapes);

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
