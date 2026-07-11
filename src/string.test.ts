// src/string.test.ts

import {
  decodeMountTableEscapes,
  decodeUdevEscapes,
  encodeEscapeSequences,
  isBlank,
  isNotBlank,
  isString,
  sortByLocale,
  sortObjectsByLocale,
  toNotBlank,
  toS,
} from "./string";

describe("OS escape sequences", () => {
  it("decodes simple space character \\040", () => {
    expect(decodeMountTableEscapes("hello\\040world")).toBe("hello world");
  });

  it("handles multiple octal sequences", () => {
    expect(decodeMountTableEscapes("\\047quote\\047")).toBe("'quote'");
  });

  it("preserves non-octal parts of the string", () => {
    expect(decodeMountTableEscapes("normal text")).toBe("normal text");
  });

  it("preserves incomplete two digit octal numbers", () => {
    expect(decodeMountTableEscapes("\\42")).toBe("\\42");
  });

  it("handles three digit octal numbers", () => {
    expect(decodeMountTableEscapes("\\101\\102\\103")).toBe("ABC");
  });

  it("handles sequences at start and end of string", () => {
    expect(decodeMountTableEscapes("\\040start")).toBe(" start");
    expect(decodeMountTableEscapes("end\\040")).toBe("end ");
  });

  it("handles consecutive octal sequences", () => {
    expect(decodeMountTableEscapes("\\047\\047")).toBe("''");
  });

  function assertRoundTrip(input: string) {
    const enc = encodeEscapeSequences(input);
    const dec = decodeMountTableEscapes(enc);
    expect(dec).toEqual(input);
  }

  it("handles the full range of valid octal values", () => {
    expect(decodeMountTableEscapes("\\040")).toBe(" "); // space character
    expect(decodeMountTableEscapes("\\377")).toBe("\xFF"); // highest valid octal
  });

  it("does not consume digits following fixed-width OS escapes", () => {
    expect(decodeMountTableEscapes("Backup\\0402026")).toBe("Backup 2026");
    expect(decodeUdevEscapes("Backup\\x202026")).toBe("Backup 2026");
  });

  it("encodes octal escapes at the mount-table width", () => {
    expect(encodeEscapeSequences("Backup 2026")).toBe("Backup\\0402026");
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
    expect(decodeMountTableEscapes("")).toBe("");
  });

  it("handles string with only octal sequences", () => {
    expect(decodeMountTableEscapes("\\040\\040\\040")).toBe("   ");
  });

  describe("edge cases", () => {
    it("ignores incomplete octal sequences", () => {
      expect(decodeMountTableEscapes("\\")).toBe("\\");
      expect(decodeMountTableEscapes("test\\")).toBe("test\\");
    });

    it("preserves backslashes not part of octal sequence", () => {
      expect(decodeMountTableEscapes("\\\\040")).toBe("\\ ");
      expect(decodeMountTableEscapes("back\\\\slash")).toBe("back\\\\slash");
    });
  });
  describe("isString", () => {
    it("returns true for strings", () => {
      expect(isString("hello")).toBe(true);
    });

    it("returns false for non-strings", () => {
      expect(isString(123)).toBe(false);
      expect(isString(null)).toBe(false);
      expect(isString(undefined)).toBe(false);
      expect(isString({})).toBe(false);
    });
  });

  describe("toS", () => {
    it("returns the string itself if input is a string", () => {
      expect(toS("hello")).toBe("hello");
    });

    it("returns an empty string for null or undefined", () => {
      expect(toS(null)).toBe("");
      expect(toS(undefined)).toBe("");
    });

    it("converts non-string input to string", () => {
      expect(toS(123)).toBe("123");
      expect(toS(true)).toBe("true");
      expect(toS({})).toBe("[object Object]");
    });
  });

  describe("isNotBlank", () => {
    it("returns true for non-blank strings", () => {
      expect(isNotBlank("hello")).toBe(true);
    });

    it("returns false for blank strings", () => {
      expect(isNotBlank("")).toBe(false);
      expect(isNotBlank("   ")).toBe(false);
    });

    it("returns false for non-strings", () => {
      expect(isNotBlank(123)).toBe(false);
      expect(isNotBlank(null)).toBe(false);
      expect(isNotBlank(undefined)).toBe(false);
    });
  });

  describe("isBlank", () => {
    it("returns false for non-blank strings", () => {
      expect(isBlank("hello")).toBe(false);
    });

    it("returns true for blank strings", () => {
      expect(isBlank("")).toBe(true);
      expect(isBlank("   ")).toBe(true);
    });

    it("returns true for non-strings", () => {
      expect(isBlank(123)).toBe(true);
      expect(isBlank(null)).toBe(true);
      expect(isBlank(undefined)).toBe(true);
    });
  });

  describe("toNotBlank", () => {
    it("returns the string itself if it is not blank", () => {
      expect(toNotBlank("hello")).toBe("hello");
    });

    it("returns undefined for blank strings", () => {
      expect(toNotBlank("")).toBeUndefined();
      expect(toNotBlank("   ")).toBeUndefined();
    });
  });

  describe("sortByLocale", () => {
    it("sorts an array of strings in locale-aware order", () => {
      const arr = ["z", "a", "ä"];
      expect(sortByLocale(arr, "de")).toEqual(["a", "ä", "z"]);
    });
  });

  describe("sortObjectsByLocale", () => {
    it("sorts an array of objects by a string key in locale-aware order", () => {
      const arr = [{ name: "z" }, { name: "a" }, { name: "ä" }];
      expect(sortObjectsByLocale(arr, (obj) => obj.name, "de")).toEqual([
        { name: "a" },
        { name: "ä" },
        { name: "z" },
      ]);
    });
  });
});
