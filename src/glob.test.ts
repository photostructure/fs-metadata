// src/glob.test.ts

import { compileGlob } from "./glob.js";

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
});
