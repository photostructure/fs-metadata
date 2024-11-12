// src/string.ts

/**
 * @return true iff the input is not a string or only has non-whitespace characters
 */
export function blank(input: unknown): boolean {
  return typeof input !== "string" || input.trim().length === 0;
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
  const escapeRegex = /\\(?:([0-7]{2,4})|x([0-9a-fA-F]{2,4}))/g;

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

export function encodeEscapeSequences(input: string): string {
  return input
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);

      // Keep ASCII characters as-is (0-127 range)
      if (code < 128) {
        return char;
      }

      // Convert to hex and pad with zeros if needed
      const hex = code.toString(16).toUpperCase();
      return `\\x${hex.padStart(4, "0")}`;
    })
    .join("");
}
