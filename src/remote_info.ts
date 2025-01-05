// src/remote_info.ts

import { debug } from "./debuglog.js";
import { compactValues, isObject } from "./object.js";
import { isWindows } from "./platform.js";
import { isBlank, isNotBlank, toS } from "./string.js";

/**
 * Represents remote filesystem information.
 */
export interface RemoteInfo {
  /**
   * We can sometimes fetch a URI of the resource (like "smb://server/share" or
   * "file:///media/user/usb")
   */
  uri?: string;
  /**
   * Protocol used to access the share.
   */
  protocol?: string;
  /**
   * Does the protocol seem to be a remote filesystem?
   */
  remote: boolean;
  /**
   * If remote, may include the username used to access the share.
   *
   * This will be undefined on NFS and other remote filesystem types that do
   * authentication out of band.
   */
  remoteUser?: string;
  /**
   * If remote, the ip or hostname hosting the share (like "rusty" or "10.1.1.3")
   */
  remoteHost?: string;
  /**
   * If remote, the name of the share (like "homes")
   */
  remoteShare?: string;
}

export function isRemoteInfo(obj: unknown): obj is RemoteInfo {
  if (!isObject(obj)) return false;
  const { remoteHost, remoteShare } = obj as Partial<RemoteInfo>;
  return isNotBlank(remoteHost) && isNotBlank(remoteShare);
}

const NETWORK_FS_TYPE_ARRAY = [
  "9p",
  "afp",
  "afs",
  "beegfs",
  "ceph",
  "cifs",
  "ftp",
  "fuse",
  "gfs2",
  "glusterfs",
  "lustre",
  "ncpfs",
  "nfs",
  "nfs4",
  "smb",
  "smbfs",
  "sshfs",
  "webdav",
] as const;

type NetworkFsType = (typeof NETWORK_FS_TYPE_ARRAY)[number];

const NETWORK_FS_TYPES = new Set<NetworkFsType>(NETWORK_FS_TYPE_ARRAY);

const FS_TYPE_ALIASES = new Map<string, NetworkFsType>([
  ["nfs1", "nfs"],
  ["nfs2", "nfs"],
  ["nfs3", "nfs"],
  ["nfs4", "nfs4"],
  ["fuse.sshfs", "sshfs"],
  ["sshfs.fuse", "sshfs"],
  ["davfs2", "webdav"],
  ["davfs", "webdav"],
  ["cifs.smb", "cifs"],
  ["smbfs", "cifs"],
  ["cephfs", "ceph"],
  ["fuse.ceph", "ceph"],
  ["fuse.cephfs", "ceph"],
  ["rbd", "ceph"],
  ["fuse.glusterfs", "glusterfs"],
] as const);

export function normalizeFsType(fstype: string): string {
  const norm = toS(fstype).toLowerCase().replace(/:$/, "");
  return FS_TYPE_ALIASES.get(norm) ?? norm;
}

export function isRemoteFsType(fstype: string | undefined): boolean {
  return (
    isNotBlank(fstype) &&
    NETWORK_FS_TYPES.has(normalizeFsType(fstype) as NetworkFsType)
  );
}

export function parseURL(s: string): URL | undefined {
  try {
    return isBlank(s) ? undefined : new URL(s);
  } catch {
    return;
  }
}

export function extractRemoteInfo(
  fsSpec: string | undefined,
): RemoteInfo | undefined {
  if (fsSpec == null || isBlank(fsSpec)) return;

  if (isWindows) {
    fsSpec = fsSpec.replace(/\\/g, "/");
  }

  const url = parseURL(fsSpec);

  if (url?.protocol === "file:") {
    return {
      remote: false,
      uri: fsSpec,
    };
  }

  const patterns = [
    {
      // CIFS/SMB pattern: //hostname/share or //user@host/share
      regex:
        /^\/\/(?:(?<remoteUser>[^/@]+)@)?(?<remoteHost>[^/@]+)\/(?<remoteShare>.+)$/,
    },
    {
      // sshfs pattern: sshfs#USER@HOST:REMOTE_PATH
      regex:
        /^(?:(?<protocol>\w+)#)?(?<remoteUser>[^@]+)@(?<remoteHost>[^:]+):(?<remoteShare>.+)$/,
    },
    {
      // NFS pattern: hostname:/share
      protocol: "nfs",
      regex: /^(?<remoteHost>[^:]+):\/(?!\/)(?<remoteShare>.+)$/,
    },
  ];

  for (const { protocol, regex } of patterns) {
    const o = compactValues({
      protocol,
      remote: true,
      ...(fsSpec.match(regex)?.groups ?? {}),
    });
    if (isRemoteInfo(o)) {
      debug("[extractRemoteInfo] matched pattern: %o", o);
      return o;
    }
  }

  // Let's try URL last, as nfs and webdav mounts are URI-ish
  try {
    // try to parse fsSpec as a uri:
    const parsed = new URL(fsSpec);
    if (parsed != null) {
      debug("[extractRemoteInfo] parsed URL: %o", parsed);
      const fstype = normalizeFsType(parsed.protocol);
      if (!isRemoteFsType(fstype)) {
        // don't set remoteUser, remoteHost, or remoteShare, it's not remote!
        return {
          uri: fsSpec,
          remote: false,
        };
      } else {
        return compactValues({
          uri: fsSpec,
          protocol: fstype,
          remote: true,
          remoteUser: parsed.username,
          remoteHost: parsed.hostname,
          // URL pathname includes leading slash:
          remoteShare: parsed.pathname.replace(/^\//, ""),
        }) as unknown as RemoteInfo;
      }
    }
  } catch {
    // ignore
  }

  return;
}
