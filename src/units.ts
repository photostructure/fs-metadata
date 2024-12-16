// src/units.ts

/**
 * KiB = 1024 bytes
 * @see https://en.wikipedia.org/wiki/Kibibyte
 */
export const KiB = 1024;

/**
 * MiB = 1024 KiB
 * @see https://en.wikipedia.org/wiki/Mebibyte
 */
export const MiB = 1024 * KiB;

/**
 * GiB = 1024 MiB
 * @see https://en.wikipedia.org/wiki/Gibibyte
 */
export const GiB = 1024 * MiB;

export function fmtBytes(bytes: number): string {
  if (bytes < KiB) {
    return `${bytes} B`;
  } else if (bytes < MiB) {
    return `${(bytes / KiB).toFixed(2)} KiB`;
  } else if (bytes < GiB) {
    return `${(bytes / MiB).toFixed(2)} MiB`;
  } else {
    return `${(bytes / GiB).toFixed(2)} GiB`;
  }
}
