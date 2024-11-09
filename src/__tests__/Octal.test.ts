import { decodeOctalEscapes } from "../Octal";

describe("decodeOctalEscapes", () => {
  it("decodes simple space character \\040", () => {
    expect(decodeOctalEscapes("hello\\040world")).toBe("hello world");
  });

  it("handles multiple octal sequences", () => {
    expect(decodeOctalEscapes("\\047quote\\047")).toBe("'quote'");
  });

  it("preserves non-octal parts of the string", () => {
    expect(decodeOctalEscapes("normal text")).toBe("normal text");
  });

  it("handles two digit octal numbers", () => {
    expect(decodeOctalEscapes("\\42")).toBe('"');
  });

  it("handles three digit octal numbers", () => {
    expect(decodeOctalEscapes("\\101\\102\\103")).toBe("ABC");
  });

  it("handles sequences at start and end of string", () => {
    expect(decodeOctalEscapes("\\040start")).toBe(" start");
    expect(decodeOctalEscapes("end\\040")).toBe("end ");
  });

  it("handles consecutive octal sequences", () => {
    expect(decodeOctalEscapes("\\047\\047")).toBe("''");
  });

  it("handles the full range of valid octal values", () => {
    expect(decodeOctalEscapes("\\40")).toBe(" "); // space character
    expect(decodeOctalEscapes("\\377")).toBe("\xFF"); // highest valid octal
  });

  it("throws error for invalid octal values", () => {
    expect(() => decodeOctalEscapes("\\000")).toThrow(/Invalid octal sequence/);
    expect(() => decodeOctalEscapes("\\400")).toThrow(/Invalid octal sequence/);
    expect(() => decodeOctalEscapes("\\777")).toThrow(/Invalid octal sequence/);
  });

  it("handles empty string", () => {
    expect(decodeOctalEscapes("")).toBe("");
  });

  it("handles string with only octal sequences", () => {
    expect(decodeOctalEscapes("\\040\\040\\040")).toBe("   ");
  });

  describe("edge cases", () => {
    it("ignores incomplete octal sequences", () => {
      expect(decodeOctalEscapes("\\")).toBe("\\");
      expect(decodeOctalEscapes("test\\")).toBe("test\\");
    });

    it("handles mixed valid and invalid sequences", () => {
      expect(() => decodeOctalEscapes("valid\\040but\\777invalid")).toThrow(
        /Invalid octal sequence/,
      );
    });

    it("preserves backslashes not part of octal sequence", () => {
      expect(decodeOctalEscapes("\\\\040")).toBe("\\ ");
      expect(decodeOctalEscapes("back\\\\slash")).toBe("back\\\\slash");
    });
  });
});
