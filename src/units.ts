// src/units.ts

/**
 * Milliseconds in a second
 */
export const SecondMs = 1000;

/**
 * Milliseconds in a minute
 */
export const MinuteMs = 60 * SecondMs;

/**
 * Milliseconds in an hour
 */
export const HourMs = 60 * MinuteMs;

/**
 * Milliseconds in a day
 */
export const DayMs = 24 * HourMs;

/**
 * Kibibyte (KiB) = 1024 bytes
 * @see https://en.wikipedia.org/wiki/Kibibyte
 */
export const KiB = 1024;

/**
 * Mebibyte (MiB) = 1024 KiB
 * @see https://en.wikipedia.org/wiki/Mebibyte
 */
export const MiB = 1024 * KiB;

/**
 * Gibibyte (GiB)= 1024 MiB
 * @see https://en.wikipedia.org/wiki/Gibibyte
 */
export const GiB = 1024 * MiB;

/**
 * Tebibyte (TiB) = 1024 GiB
 *
 * @see https://en.wikipedia.org/wiki/Byte#Multiple-byte_units
 */
export const TiB = 1024 * GiB;

const f = 1023.995 / 1024;

export function fmtBytes(bytes: number): string {
  if (bytes < 1023.5) {
    bytes = Math.round(bytes);
    return `${bytes} B`;
  } else if (bytes < MiB * f) {
    return `${(bytes / KiB).toFixed(2)} KiB`;
  } else if (bytes < GiB * f) {
    return `${(bytes / MiB).toFixed(2)} MiB`;
  } else if (bytes < TiB * f) {
    return `${(bytes / GiB).toFixed(2)} GiB`;
  } else {
    return `${(bytes / TiB).toFixed(2)} TiB`;
  }
}
