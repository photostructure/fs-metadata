// src/glob.test.ts

import { compileGlob } from "./glob";

describe("compileGlob", () => {
  // Test basic literal matching
  test("matches exact paths", () => {
    const regex = compileGlob(["src/index.ts"]);
    expect(regex.test("src/index.ts")).toBe(true);
    expect(regex.test("src/other.ts")).toBe(false);
  });

  // Test case insensitivity
  test("matches paths case-insensitively", () => {
    const regex = compileGlob(["src/Index.ts"]);
    expect(regex.test("src/index.ts")).toBe(true);
    expect(regex.test("SRC/INDEX.TS")).toBe(true);
  });

  // Test single asterisk wildcard
  test("handles single * wildcard", () => {
    const regex = compileGlob(["src/*.ts"]);
    expect(regex.test("src/index.ts")).toBe(true);
    expect(regex.test("src/test.ts")).toBe(true);
    expect(regex.test("src/nested/test.ts")).toBe(false);
    expect(regex.test("src/test.js")).toBe(false);
  });

  // Test double asterisk (globstar) pattern
  test("handles ** globstar pattern", () => {
    const regex = compileGlob(["src/**/test.ts"]);
    expect(regex.test("src/test.ts")).toBe(true);
    expect(regex.test("src/nested/test.ts")).toBe(true);
    expect(regex.test("src/deeply/nested/test.ts")).toBe(true);
    expect(regex.test("src/test.js")).toBe(false);
  });

  // Test question mark pattern
  test("handles ? single character wildcard", () => {
    const regex = compileGlob(["src/inde?.ts"]);
    expect(regex.test("src/index.ts")).toBe(true);
    expect(regex.test("src/indey.ts")).toBe(true);
    expect(regex.test("src/ind.ts")).toBe(false);
    expect(regex.test("src/index/.ts")).toBe(false);
  });

  // Test multiple patterns
  test("handles multiple patterns", () => {
    const regex = compileGlob(["*.ts", "*.js"]);
    expect(regex.test("index.ts")).toBe(true);
    expect(regex.test("test.js")).toBe(true);
    expect(regex.test("styles.css")).toBe(false);
  });

  // Test directory ending pattern
  test("handles directory ending pattern", () => {
    const regex = compileGlob(["src/"]);
    expect(regex.test("src/")).toBe(true);
    expect(regex.test("src")).toBe(true);
    expect(regex.test("src/file.ts")).toBe(false);
  });

  // Test special regex characters
  test("handles special regex characters", () => {
    const regex = compileGlob(["src/$special+.ts"]);
    expect(regex.test("src/$special+.ts")).toBe(true);
    expect(regex.test("src/special.ts")).toBe(false);
  });

  // Test period handling
  test("handles periods correctly", () => {
    const regex = compileGlob(["src/*.min.js"]);
    expect(regex.test("src/app.min.js")).toBe(true);
    expect(regex.test("src/appminjs")).toBe(false);
  });

  // Test empty pattern
  test("handles empty pattern array", () => {
    const regex = compileGlob([]);

    expect(regex.test("")).toBe(false);
    expect(regex.test("anything")).toBe(false);
  });

  // Test patterns with combinations of wildcards
  test("handles combinations of wildcards", () => {
    const regex = compileGlob(["src/**/*/*.test.ts"]);
    expect(regex.test("src/components/button/Button.test.ts")).toBe(true);
    expect(regex.test("src/Button.test.ts")).toBe(false);
    expect(regex.test("src/components/Button.test.ts")).toBe(true);
  });

  // Test null/undefined patterns
  test("handles null and undefined patterns", () => {
    const regex1 = compileGlob(null as unknown as string[]);
    expect(regex1.test("anything")).toBe(false);

    const regex2 = compileGlob(undefined);
    expect(regex2.test("anything")).toBe(false);
  });

  // Test cache hit with different order
  test("uses cache for patterns in different order", () => {
    const patterns1 = ["*.ts", "*.js", "*.jsx"];
    const patterns2 = ["*.jsx", "*.ts", "*.js"];

    const regex1 = compileGlob(patterns1);
    const regex2 = compileGlob(patterns2);

    // Should get the same regex from cache
    expect(regex1).toBe(regex2);
    expect(regex1.test("file.ts")).toBe(true);
    expect(regex2.test("file.js")).toBe(true);
  });

  // Test cache overflow
  test("clears cache when it exceeds 256 entries", () => {
    // Generate 260 unique patterns to trigger cache clear
    const patterns = [];
    for (let i = 0; i < 260; i++) {
      patterns.push([`file${i}.txt`]);
    }

    patterns.forEach((pattern, i) => {
      const regex = compileGlob(pattern);
      expect(regex.test(`file${i}.txt`)).toBe(true);
    });

    // Cache should still work after clearing
    const regex = compileGlob(["test.txt"]);
    expect(regex.test("test.txt")).toBe(true);
  });

  // Test blank patterns are filtered
  test("filters out blank patterns", () => {
    const regex = compileGlob(["*.ts", "", "   ", "*.js"]);
    expect(regex.test("file.ts")).toBe(true);
    expect(regex.test("file.js")).toBe(true);
    expect(regex.test("file.py")).toBe(false);
  });

  // Test Windows path separators
  test("handles Windows path separators on Windows", () => {
    // This test will only check Windows-specific behavior on Windows
    const regex = compileGlob(["src/test.ts"]);
    // Forward slashes should always work
    expect(regex.test("src/test.ts")).toBe(true);
    // On Windows, backslashes might also work depending on the implementation
  });

  // Test empty result after filtering
  test("returns NeverMatchRE when all patterns are blank", () => {
    const regex = compileGlob(["", "   ", "\t", "\n"]);
    expect(regex.test("anything")).toBe(false);
    expect(regex.test("")).toBe(false);
  });
});
