import { isObject } from "./object.js";
import { isWindows } from "./platform.js";
import { isBlank, isNotBlank } from "./string.js";

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
  remoteHost: string;
  /**
   * If remote, the name of the share (like "homes")
   */
  remoteShare: string;
}

export function isRemoteInfo(obj: unknown): obj is RemoteInfo {
  if (!isObject(obj)) return false;
  const { remoteHost, remoteShare } = obj as Partial<RemoteInfo>;
  return isNotBlank(remoteHost) && isNotBlank(remoteShare);
}

const NETWORK_FS_TYPES = new Set([
  "9p",
  "afp",
  "afs",
  "beegfs",
  "ceph",
  "cifs",
  "ftp",
  "fuse.cephfs",
  "fuse.glusterfs",
  "fuse.sshfs",
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
]);

function normalizeProtocol(protocol: string): string {
  return (protocol ?? "").toLowerCase().replace(/:$/, "");
}

export function isRemoteFsType(fstype: string | undefined): boolean {
  return isNotBlank(fstype) && NETWORK_FS_TYPES.has(normalizeProtocol(fstype));
}

export function extractRemoteInfo(
  fsSpec: string | undefined,
): RemoteInfo | undefined {
  if (fsSpec == null || isBlank(fsSpec)) return;

  // Let's try URL first, as it's the most robust:
  try {
    // try to parse fsSpec as a uri:
    const url = new URL(fsSpec);
    if (url != null) {
      const protocol = normalizeProtocol(url.protocol);
      const o = {
        uri: fsSpec,
        protocol,
        remote: isRemoteFsType(protocol),
        remoteUser: url.username,
        remoteHost: url.hostname,
        remoteShare: url.pathname,
      };
      if (isRemoteInfo(o)) return o;
    }
  } catch {
    // ignore
  }

  if (isWindows) {
    fsSpec = fsSpec.replace(/\\/g, "/");
  }

  const patterns = [
    // CIFS/SMB pattern: //hostname/share or //user@host/share
    {
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
    } as RemoteInfo;
    if (isRemoteInfo(o)) return o;
  }

  return;
}