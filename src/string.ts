// src/string.ts

export function isString(input: unknown): input is string {
  return typeof input === "string";
}

export function toS(input: unknown): string {
  return isString(input) ? input : input == null ? "" : String(input);
}

/**
 * @return true iff the input is a string and has at least one non-whitespace character
 */
export function isNotBlank(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0;
}

/**
 * @return true iff the input is not a string or only has non-whitespace characters
 */
export function isBlank(input: unknown): input is undefined {
  return !isNotBlank(input);
}

export function toNotBlank(input: unknown): string | undefined {
  return isNotBlank(input) ? input : undefined;
}

/** Decode the exactly three-digit octal escapes used by fstab/mtab. */
export function decodeMountTableEscapes(input: string): string {
  return input.replace(/\\([0-3][0-7]{2})/g, (_match, octal: string) =>
    String.fromCharCode(parseInt(octal, 8)),
  );
}

/** Decode the exactly two-digit hexadecimal escapes used by udev symlinks. */
export function decodeUdevEscapes(input: string): string {
  return input.replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

const AlphaNumericRE = /[/\w.-]/;

/**
 * Encode Latin-1 code units other than `/`, word characters, `.`, and `-` as
 * three-digit octal escapes; preserve higher Unicode code units unchanged.
 */
export function encodeEscapeSequences(input: string): string {
  return input
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      return AlphaNumericRE.test(char) || code > 0xff
        ? char
        : "\\" + code.toString(8).padStart(3, "0");
    })
    .join("");
}

/**
 * Sort an array of strings using the locale-aware collation algorithm.
 *
 * @param arr The array of strings to sort. The original array **is sorted in
 * place**.
 */
export function sortByLocale(
  arr: string[],
  locales?: Intl.LocalesArgument,
  options?: Intl.CollatorOptions,
): string[] {
  return arr.sort((a, b) => a.localeCompare(b, locales, options));
}

/**
 * Sort an array of objects using the locale-aware collation algorithm.
 *
 * @param arr The array of objects to sort.
 * @param fn The function to extract the key to sort by from each object.
 * @param locales The locales to use for sorting.
 * @param options The collation options to use for sorting.
 */
export function sortObjectsByLocale<T>(
  arr: T[],
  fn: (key: T) => string,
  locales?: Intl.LocalesArgument,
  options?: Intl.CollatorOptions,
): T[] {
  return arr.sort((a, b) => fn(a).localeCompare(fn(b), locales, options));
}
