// src/uuid.test.ts

import { extractUUID } from "./uuid.js";

describe("extractUUID", () => {
  // Valid UUID formats
  test("extracts basic 8-character UUID", () => {
    expect(extractUUID("ABCD1234")).toBe("ABCD1234");
  });

  test("extracts basic 8-character UUID with hyphen prefix", () => {
    expect(extractUUID(" -ABCD1234 ")).toBe("ABCD1234");
  });

  test("extracts UUID with hyphens", () => {
    expect(extractUUID("1234-5678-90ab")).toBe("1234-5678-90ab");
  });

  test("extracts UUID with mixed case", () => {
    expect(extractUUID("AbCd-12-EfGh")).toBe("AbCd-12-EfGh");
  });

  test("extracts UUID from Windows volume format", () => {
    expect(extractUUID("\\\\?\\Volume{1234abcd-ef56}\\")).toBe("1234abcd-ef56");
  });

  test("extracts long UUID", () => {
    expect(extractUUID("12345678-90ab-cdef-ghij-klmnopqrstuv!")).toBe(
      "12345678-90ab-cdef-ghij-klmnopqrstuv",
    );
  });

  // Invalid formats
  test("returns undefined for undefined input", () => {
    expect(extractUUID(undefined)).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(extractUUID("")).toBeUndefined();
  });

  test("returns undefined for too short UUID", () => {
    expect(extractUUID("123456")).toBeUndefined();
  });

  test("returns undefined for UUID starting with hyphen", () => {
    expect(extractUUID("-abcd12")).toBeUndefined();
  });

  test("returns undefined for UUID with invalid characters", () => {
    expect(extractUUID("abcd!@#$")).toBeUndefined();
  });

  test("returns undefined for non-string input", () => {
    // @ts-expect-error Testing invalid input type
    expect(extractUUID(1234567)).toBeUndefined();
  });

  // Edge cases
  test("ignores surrounding whitespace", () => {
    expect(extractUUID("  abcd1234  ")).toBe("abcd1234");
  });

  test("extracts first UUID when multiple exist", () => {
    expect(extractUUID("abcd1234 efgh5678")).toBe("abcd1234");
  });

  test("extracts UUID from middle of string", () => {
    expect(extractUUID("prefix-abcd1234-suffix")).toBe(
      "prefix-abcd1234-suffix",
    );
    expect(extractUUID("prefix abcd1234 suffix")).toBe("abcd1234");
  });

  test("handles maximum reasonable length", () => {
    const longUuid = "a".repeat(50);
    expect(extractUUID(longUuid)).toBe(longUuid);
  });
});
