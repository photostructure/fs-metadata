/**
 * Converts a string containing octal escape sequences to its decoded form.
 * Handles octal sequences in the format \040 through \377
 *
 * @param input - The string containing octal escape sequences
 * @returns The decoded string with octal sequences converted to their character equivalents
 *
 * @example
 * convert("hello\040world") // returns "hello world"
 * convert("test\047string\047") // returns "test'string'"
 */
export function decodeOctalEscapes(input: string): string {
  // Match octal sequences \000 through \377
  return input.replace(/\\([0-7]{2,3})/g, (match, octal) => {
    // Convert octal string to number
    const charCode = parseInt(octal, 8);

    // Ensure the octal value is valid (0-255)
    if (charCode > 255 || charCode < 32) {
      throw new Error(`Invalid octal sequence: \${match} (decimal: ${charCode})`);
    }

    // Convert to character
    return String.fromCharCode(charCode);
  });
}
