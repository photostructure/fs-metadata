// src/__tests__/string.test.ts

import { decodeEscapeSequences, encodeEscapeSequences } from "../string.js";

describe("decodeOctalEscapes", () => {
  it("decodes simple space character \\040", () => {
    expect(decodeEscapeSequences("hello\\040world")).toBe("hello world");
  });

  it("handles multiple octal sequences", () => {
    expect(decodeEscapeSequences("\\047quote\\047")).toBe("'quote'");
  });

  it("preserves non-octal parts of the string", () => {
    expect(decodeEscapeSequences("normal text")).toBe("normal text");
  });

  it("handles two digit octal numbers", () => {
    expect(decodeEscapeSequences("\\42")).toBe('"');
  });

  it("handles three digit octal numbers", () => {
    expect(decodeEscapeSequences("\\101\\102\\103")).toBe("ABC");
  });

  it("handles sequences at start and end of string", () => {
    expect(decodeEscapeSequences("\\040start")).toBe(" start");
    expect(decodeEscapeSequences("end\\040")).toBe("end ");
  });

  it("handles consecutive octal sequences", () => {
    expect(decodeEscapeSequences("\\047\\047")).toBe("''");
  });

  function assertRoundTrip(input: string) {
    const enc = encodeEscapeSequences(input);
    const dec = decodeEscapeSequences(enc);
    console.log({ input, enc, dec });
    expect(dec).toEqual(input);
  }

  it("handles the full range of valid octal values", () => {
    expect(decodeEscapeSequences("\\40")).toBe(" "); // space character
    expect(decodeEscapeSequences("\\377")).toBe("\xFF"); // highest valid octal
  });

  it("handles hindi characters", () => {
    assertRoundTrip("उदाहरण-file.txt");
  });

  it("handles chinese-traditional characters", () => {
    assertRoundTrip("範例文件.txt");
  });

  it("handles greek characters", () => {
    assertRoundTrip("παράδειγμα-αρχείο.txt");
  });

  it("handles empty string", () => {
    expect(decodeEscapeSequences("")).toBe("");
  });

  it("handles string with only octal sequences", () => {
    expect(decodeEscapeSequences("\\040\\040\\040")).toBe("   ");
  });

  describe("edge cases", () => {
    it("ignores incomplete octal sequences", () => {
      expect(decodeEscapeSequences("\\")).toBe("\\");
      expect(decodeEscapeSequences("test\\")).toBe("test\\");
    });

    it("preserves backslashes not part of octal sequence", () => {
      expect(decodeEscapeSequences("\\\\040")).toBe("\\ ");
      expect(decodeEscapeSequences("back\\\\slash")).toBe("back\\\\slash");
    });
  });
});
