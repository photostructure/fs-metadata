// src/uuid.ts

const uuidRegex = /[a-z0-9-]{10,}/i;
export function extractUUID(uuid: string | undefined): string | undefined {
  return uuid?.match(uuidRegex)?.[0];
}
