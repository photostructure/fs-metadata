// src/string.ts

/**
 * @return true iff the input is not a string or only has non-whitespace characters
 */
export function isBlank(input: unknown): boolean {
  return typeof input !== "string" || input.trim().length === 0;
}

export function toNotBlank(input: string): string | undefined {
  return isBlank(input) ? undefined : input;
}

function fromCharCode(charCode: number, match: string): string {
  return String.fromCharCode(charCode);
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
      return fromCharCode(parseInt(octal, 8), match);
    }

    // Handle hexadecimal escape sequences
    if (hex != null) {
      return fromCharCode(parseInt(hex, 16), match);
    }

    // This should never happen due to the regex pattern
    throw new Error(`Invalid escape sequence: ${match}`);
  });
}

const AlphaNumericRE = /[a-z0-9.-_]/i;

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
