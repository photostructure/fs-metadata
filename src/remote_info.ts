// src/remote_info.ts

import { debug } from "./debuglog";
import { compactValues, isObject } from "./object";
import { NetworkFsTypesDefault } from "./options";
import { isWindows } from "./platform";
import { isBlank, isNotBlank, toS } from "./string";
import { RemoteInfo } from "./types/remote_info";

export function isRemoteInfo(obj: unknown): obj is RemoteInfo {
  if (!isObject(obj)) return false;
  const { remoteHost, remoteShare } = obj as Partial<RemoteInfo>;
  return isNotBlank(remoteHost) && isNotBlank(remoteShare);
}

/**
 * Aliases that map variant filesystem type names to canonical names.
 */
const FS_TYPE_ALIASES = new Map<string, string>([
  ["nfs1", "nfs"],
  ["nfs2", "nfs"],
  ["nfs3", "nfs"],
  ["fuse.sshfs", "sshfs"],
  ["sshfs.fuse", "sshfs"],
  ["davfs2", "webdav"],
  ["davfs", "webdav"],
  ["cifs.smb", "cifs"],
  ["cephfs", "ceph"],
  ["fuse.ceph", "ceph"],
  ["fuse.cephfs", "ceph"],
  ["rbd", "ceph"],
  ["fuse.glusterfs", "glusterfs"],
]);

export function normalizeFsType(fstype: string): string {
  const norm = toS(fstype).toLowerCase().replace(/:$/, "");
  return FS_TYPE_ALIASES.get(norm) ?? norm;
}

/**
 * Check if a filesystem type indicates a remote/network volume.
 *
 * @param fstype - The filesystem type to check
 * @param networkFsTypes - List of network filesystem types (defaults to {@link NetworkFsTypesDefault})
 */
export function isRemoteFsType(
  fstype: string | undefined,
  networkFsTypes: readonly string[] = NetworkFsTypesDefault,
): boolean {
  if (!isNotBlank(fstype)) return false;
  const normalized = normalizeFsType(fstype);
  return networkFsTypes.some(
    (nft) => nft === normalized || normalized.startsWith(nft + "."),
  );
}

export function parseURL(s: string): URL | undefined {
  try {
    return isBlank(s) ? undefined : new URL(s);
  } catch {
    return;
  }
}

/**
 * Extract remote connection info from a filesystem spec string.
 *
 * @param fsSpec - The filesystem spec (e.g., "//host/share", "host:/path", URI)
 * @param networkFsTypes - List of network filesystem types (defaults to {@link NetworkFsTypesDefault})
 */
export function extractRemoteInfo(
  fsSpec: string | undefined,
  networkFsTypes: readonly string[] = NetworkFsTypesDefault,
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
        // eslint-disable-next-line security/detect-unsafe-regex -- parsing trusted mount paths from OS, bounded by line anchors
        /^\/\/(?:(?<remoteUser>[^/@]+)@)?(?<remoteHost>[^/@]+)\/(?<remoteShare>.*)$/,
    },
    {
      // sshfs pattern: sshfs#USER@HOST:REMOTE_PATH
      regex:
        // eslint-disable-next-line security/detect-unsafe-regex -- parsing trusted mount paths from OS, bounded by line anchors
        /^(?:(?<protocol>\w+)#)?(?<remoteUser>[^@]+)@(?<remoteHost>[^:]+):(?<remoteShare>.*)$/,
    },
    {
      // NFS pattern: hostname:/share
      protocol: "nfs",
      regex: /^(?<remoteHost>[^:]+):\/(?!\/)(?<remoteShare>.*)$/,
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
      if (!isRemoteFsType(fstype, networkFsTypes)) {
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
