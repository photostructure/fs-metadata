import { parseUNCPath } from "../unc.js";

describe("parseUNCPath", () => {
  // Valid UNC paths
  test("parses valid UNC path with backslashes", () => {
    const result = parseUNCPath("\\\\server\\share");
    expect(result).toEqual({
      remoteHost: "server",
      remoteShare: "share",
    });
  });

  test("parses valid UNC path with forward slashes", () => {
    const result = parseUNCPath("//server/share");
    expect(result).toEqual({
      remoteHost: "server",
      remoteShare: "share",
    });
  });

  test("parses valid UNC path with additional path components", () => {
    const result = parseUNCPath("\\\\server\\share\\folder\\file.txt");
    expect(result).toEqual({
      remoteHost: "server",
      remoteShare: "share",
    });
  });

  test("parses UNC path with complex server and share names", () => {
    const result = parseUNCPath("\\\\server-name.123\\share_name-123");
    expect(result).toEqual({
      remoteHost: "server-name.123",
      remoteShare: "share_name-123",
    });
  });

  // Invalid inputs
  test("returns undefined for null input", () => {
    expect(parseUNCPath(null)).toBeUndefined();
  });

  test("returns undefined for undefined input", () => {
    expect(parseUNCPath(undefined)).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(parseUNCPath("")).toBeUndefined();
  });

  test("returns undefined for non-string input", () => {
    // @ts-expect-error Intentionally testing invalid input type
    expect(parseUNCPath(123)).toBeUndefined();
  });

  // Invalid UNC paths
  test("returns undefined for path with single slash", () => {
    expect(parseUNCPath("\\server\\share")).toBeUndefined();
    expect(parseUNCPath("/server/share")).toBeUndefined();
  });

  test("returns undefined for path with mixed slashes", () => {
    expect(parseUNCPath("\\\\server/share")).toBeUndefined();
    expect(parseUNCPath("//server\\share")).toBeUndefined();
  });

  test("returns undefined for path without share name", () => {
    expect(parseUNCPath("\\\\server\\")).toBeUndefined();
    expect(parseUNCPath("//server/")).toBeUndefined();
  });

  test("returns undefined for path with empty server name", () => {
    expect(parseUNCPath("\\\\\\share")).toBeUndefined();
    expect(parseUNCPath("///share")).toBeUndefined();
  });

  test("returns undefined for path with empty share name", () => {
    expect(parseUNCPath("\\\\server\\")).toBeUndefined();
    expect(parseUNCPath("//server/")).toBeUndefined();
  });

  // Invalid characters
  test("returns undefined for server name with invalid characters", () => {
    const invalidChars = ["<", ">", ":", '"', "|", "?", "*"];
    invalidChars.forEach((char) => {
      expect(parseUNCPath(`\\\\server${char}name\\share`)).toBeUndefined();
    });
  });

  test("returns undefined for share name with invalid characters", () => {
    const invalidChars = ["<", ">", ":", '"', "|", "?", "*"];
    invalidChars.forEach((char) => {
      expect(parseUNCPath(`\\\\server\\share${char}name`)).toBeUndefined();
    });
  });

  // Edge cases
  test("handles whitespace-only server or share names", () => {
    expect(parseUNCPath("\\\\   \\share")).toBeUndefined();
    expect(parseUNCPath("\\\\server\\   ")).toBeUndefined();
  });

  test("handles paths with unicode characters", () => {
    const result = parseUNCPath("\\\\서버\\共有");
    expect(result).toEqual({
      remoteHost: "서버",
      remoteShare: "共有",
    });
  });
});
