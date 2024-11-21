// src/linux/mtab.ts

import { toInt } from "../number.js";
import { isObject } from "../object.js";
import {
  decodeEscapeSequences,
  encodeEscapeSequences,
  isBlank,
  isNotBlank,
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

// const NETWORK_FS_TYPES = new Set([
//   "9p",
//   "afp",
//   "afs",
//   "beegfs",
//   "ceph",
//   "cifs",
//   "ftp",
//   "fuse.cephfs",
//   "fuse.glusterfs",
//   "fuse.sshfs",
//   "fuse",
//   "gfs2",
//   "glusterfs",
//   "lustre",
//   "ncpfs",
//   "nfs",
//   "nfs4",
//   "smb",
//   "smbfs",
//   "sshfs",
//   "webdav",
// ]);

// export function isRemoteFS(fstype: string): boolean {
//   return NETWORK_FS_TYPES.has(fstype.toLowerCase());
// }

/**
 * Represents remote filesystem information.
 */
export interface RemoteFSInfo {
  /**
   * Protocol used to access the share.
   */
  protocol: string;
  /**
   * Username used to access the share. May be undefined.
   */
  remoteUser?: string;
  /**
   * Hostname or IP address.
   */
  remoteHost: string;
  /**
   * Share name.
   */
  remoteShare: string;
}

export function isRemoteFSInfo(obj: unknown): obj is RemoteFSInfo {
  if (!isObject(obj)) return false;
  const {
    protocol,
    remoteHost: hostname,
    remoteShare: share,
  } = obj as Partial<RemoteFSInfo>;
  return isNotBlank(protocol) && isNotBlank(hostname) && isNotBlank(share);
}

/**
 * Given a stat.fs_spec or `mountFrom`, try to extract a RemoteFSInfo object.
 */
export function parseFsSpec(
  fsSpec: string | undefined,
): RemoteFSInfo | undefined {
  if (fsSpec == null || isBlank(fsSpec)) return;

  // Let's try URL first, as it's the most robust:
  try {
    // try to parse fsSpec as a uri:
    const url = new URL(fsSpec);
    if (url != null) {
      const o = {
        protocol: url.protocol,
        remoteUser: url.username,
        remoteHost: url.hostname,
        remoteShare: url.pathname,
      };
      if (isRemoteFSInfo(o)) return o;
    }
  } catch {
    // ignore
  }

  const patterns = [
    // CIFS/SMB pattern: //hostname/share or //user@host/share
    {
      protocol: "cifs",
      regex:
        /^\/\/(?:(?<remoteUser>[^/@]+)@)?(?<remoteHost>[^/@]+)\/(?<remoteShare>.+)$/,
    },
    // NFS pattern: hostname:/share
    {
      protocol: "nfs",
      regex: /^(?<remoteHost>[^:]+):\/(?<remoteShare>.+)$/,
    },
  ];

  for (const { protocol, regex } of patterns) {
    const o = {
      protocol,
      ...(fsSpec.match(regex)?.groups ?? {}),
    } as RemoteFSInfo;
    if (isRemoteFSInfo(o)) return o;
  }

  return;
}

/**
 * Parses an mtab/fstab file content into structured mount entries
 * @param content - Raw content of the mtab/fstab file
 * @returns Array of parsed mount entries
 */
export function parseMtab(
  content: string,
): (MountEntry | (MountEntry & RemoteFSInfo))[] {
  const entries: (MountEntry | (MountEntry & RemoteFSInfo))[] = [];
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

    const mountEntry: MountEntry = {
      fs_spec: fields[0]!,
      fs_file: normalizeLinuxMountPoint(fields[1] ?? ""),
      fs_vfstype: fields[2]!,
      fs_mntops: fields[3]!,
      fs_freq: toInt(fields[4]),
      fs_passno: toInt(fields[5]),
    };

    const remoteInfo = parseFsSpec(mountEntry.fs_spec);
    if (remoteInfo) {
      entries.push({ ...mountEntry, ...remoteInfo });
    } else {
      entries.push(mountEntry);
    }
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
        entry.fs_freq?.toString(),
        entry.fs_passno?.toString(),
      ];
      return fields.join("\t");
    })
    .join("\n");
}
