export function compileGlob(patterns: string[] | readonly string[]): RegExp {
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
      if (pattern[i] === "/" && i === pattern.length - 1) {
        regex += "(?:/|$)";
        i++;
        continue;
      }

      // Escape other regex special characters
      if (/[+^${}()|[\]\\]/.test(pattern[i])) {
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
  const final = regexPatterns.filter(ea => ea.length > 0);
return (final.length === 0) ?
// Empty pattern matches nothing
 /(?!)/ 
// Case insensitive for Windows paths
:  new RegExp(`^(?:${final.join("|")})$`, "i"); 
}
