// src/glob.ts

import { isWindows } from "./platform.js";
import { isNotBlank } from "./string.js";

const cache = new Map<string, RegExp>();

/**
 * Compiles an array of glob patterns into a single regular expression.
 *
 * The function supports the following patterns:
 * - `**` matches any number of directories.
 * - `*` matches any number of characters except for `/`.
 * - `?` matches exactly one character except for `/`.
 * - `.` is escaped to match a literal period.
 * - `/` at the end of the pattern matches either a slash or the end of the string.
 * - Other regex special characters are escaped.
 *
 * @param patterns - An array of glob patterns to compile.
 * @returns A `RegExp` object that matches any of the provided patterns.
 */
export function compileGlob(
  patterns: string[] | readonly string[] | undefined,
): RegExp {
  if (patterns == null || patterns.length === 0) {
    return NeverMatchRE;
  }
  const patternsKey = JSON.stringify(patterns);
  {
    const prior = cache.get(patternsKey);
    if (prior != null) {
      return prior;
    }
  }

  const sorted = patterns.slice().filter(isNotBlank).sort();
  const sortedKey = JSON.stringify(sorted);
  {
    const prior = cache.get(sortedKey);
    if (prior != null) {
      cache.set(patternsKey, prior);
      return prior;
    }
  }

  const result = _compileGlob(sorted);
  if (cache.size > 256) {
    // avoid unbounded memory usage
    cache.clear();
  }

  cache.set(patternsKey, result);
  cache.set(sortedKey, result);
  return result;
}

function _compileGlob(patterns: string[] | readonly string[]): RegExp {
  const regexPatterns = patterns.map((pattern) => {
    let regex = "";
    let i = 0;
    while (i < pattern.length) {
      // Handle '**' pattern
      if (pattern[i] === "*" && pattern[i + 1] === "*") {
        regex += ".*";
        i += 2;
        if (pattern[i] === "/") {
          i++; // Skip the slash after **
        }
        continue;
      }

      // Handle single '*' pattern
      if (pattern[i] === "*") {
        regex += "[^/]*";
        i++;
        continue;
      }

      // Handle '?' pattern
      if (pattern[i] === "?") {
        regex += "[^/]";
        i++;
        continue;
      }

      // Handle period
      if (pattern[i] === ".") {
        regex += "\\.";
        i++;
        continue;
      }

      // Handle end of directory pattern
      if (pattern[i] === "/") {
        if (i === pattern.length - 1) {
          regex += "(?:/|$)";
          i++;
          continue;
        } else if (isWindows) {
          regex += "[\\/\\\\]";
          i++;
          continue;
        }
      }

      // Escape other regex special characters
      if (/[+^${}()|[\]\\]/.test(pattern[i]!)) {
        regex += "\\" + pattern[i];
        i++;
        continue;
      }

      // Add other characters as-is
      regex += pattern[i];
      i++;
    }
    return regex;
  });
  const final = regexPatterns.filter((ea) => ea.length > 0);
  return final.length === 0
    ? // Empty pattern matches nothing
      NeverMatchRE // Case insensitive for Windows paths
    : new RegExp(`^(?:${final.join("|")})$`, "i");
}

export const AlwaysMatchRE = /(?:)/;
export const NeverMatchRE = /(?!)/;
