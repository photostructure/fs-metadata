// src/uuid.ts

// Some disk UUIDs are short, like, `ABCD-1234`. Windows likes to put rando prefix and suffix wrappers, like "\\\\?\\Volume{e6666cf5-03dc-440b-b6a0-acc3c909bb93}\\"
const uuidRegex = /[a-z0-9-]{8,}/i;
export function extractUUID(uuid: string | undefined): string | undefined {
  return uuid?.match(uuidRegex)?.[0];
}
