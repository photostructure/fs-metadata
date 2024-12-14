// src/unc.ts

import { RemoteInfo } from "./remote_info.js";
import { isBlank, isString } from "./string.js";

/**
 * Checks if a string is formatted as a valid UNC path.
 * A valid UNC path starts with double backslashes or slashes,
 * followed by a server/host name, and then a share name.
 * The path must use consistent slashes (all forward or all backward).
 *
 * @param path - The string to check
 * @returns boolean - True if the string is a valid UNC path, false otherwise
 */
export function parseUNCPath(
  path: string | null | undefined,
): RemoteInfo | undefined {
  if (path == null || isBlank(path) || !isString(path)) {
    return;
  }

  // Check for two forward slashes or two backslashes at start
  if (!path.startsWith("\\\\") && !path.startsWith("//")) {
    return;
  }

  // Determine slash type from the start of the path
  const isForwardSlash = path.startsWith("//");
  const slashChar = isForwardSlash ? "/" : "\\";

  // Split path using the correct slash type
  const parts = path.slice(2).split(slashChar);

  // Check minimum required parts (server and share)
  if (parts.length < 2) {
    return;
  }

  // Validate server and share names exist and aren't empty
  const [remoteHost, remoteShare] = parts;
  if (
    remoteHost == null ||
    isBlank(remoteHost) ||
    remoteShare == null ||
    isBlank(remoteShare)
  ) {
    return;
  }

  // Check for invalid characters in server and share names
  const invalidChars = /[<>:"|?*]/;
  if (invalidChars.test(remoteHost) || invalidChars.test(remoteShare)) {
    return;
  }

  // Check for mixed slash usage
  const wrongSlash = isForwardSlash ? "\\" : "/";
  if (path.includes(wrongSlash)) {
    return;
  }

  return { remoteHost, remoteShare, remote: true };
}
