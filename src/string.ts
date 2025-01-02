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

/**
 * Decodes a string containing octal (\000-\377) and/or hexadecimal
 * (\x00-\xFF) escape sequences
 * @param input The string containing escape sequences to decode
 * @returns The decoded string with escape sequences converted to their
 * corresponding characters
 * @throws Error if an invalid escape sequence is encountered
 */
export function decodeEscapeSequences(input: string): string {
  const escapeRegex = /\\(?:([0-7]{2,6})|x([0-9a-fA-F]{2,4}))/g;

  return input.replace(escapeRegex, (match, octal, hex) => {
    // Handle octal escape sequences
    if (octal != null) {
      return String.fromCharCode(parseInt(octal, 8));
    }

    // Handle hexadecimal escape sequences
    if (hex != null) {
      return String.fromCharCode(parseInt(hex, 16));
    }

    // This should never happen due to the regex pattern
    throw new Error(`Invalid escape sequence: ${match}`);
  });
}

const AlphaNumericRE = /[/\w.-]/;

export function encodeEscapeSequences(input: string): string {
  return input
    .split("")
    .map((char) => {
      const encodedChar = AlphaNumericRE.test(char)
        ? char
        : "\\" + char.charCodeAt(0).toString(8).padStart(2, "0");
      return encodedChar;
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
