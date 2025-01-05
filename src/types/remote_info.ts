// src/types/remote_info.ts

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
