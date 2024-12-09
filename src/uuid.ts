// src/uuid.ts

import { toS } from "./string.js";

const uuidRegex = /[a-z0-9][a-z0-9-]{7,}/i;

/**
 * Some volume UUIDs are short, like, `ABCD1234`.
 *
 * Some volume UUIDs are in hexadecimal, but others and use G-Z. We will allow
 * that.
 *
 * Some Windows syscalls wrap the UUID in a "\\\\?\\Volume{...}\\" prefix and
 * suffix. This function will strip out that prefix and suffix.
 *
 * We will ignore any UUID-ish string that is not at least 8 characters long
 * (and return `undefined` if no other, longer uuid-ish string is found).
 *
 * UUIDs cannot start with a hyphen, and can only contain a-z, 0-9, and hyphens
 * (case-insensitive).
 */
export function extractUUID(uuid: string | undefined): string | undefined {
  return toS(uuid).match(uuidRegex)?.[0];
}
