import { isNotBlank } from "./string.js";

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

export function isRemoteFsType(fstype: string | undefined): boolean {
  return isNotBlank(fstype) && NETWORK_FS_TYPES.has(fstype.toLowerCase());
}
