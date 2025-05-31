import { GiB, KiB, MiB, TiB, fmtBytes } from "./units";

describe("units", () => {
  describe("fmtBytes", () => {
    it("should format bytes", () => {
      expect(fmtBytes(0)).toBe("0 B");
      expect(fmtBytes(512)).toBe("512 B");
      expect(fmtBytes(1023)).toBe("1023 B");
    });

    it("should format KiB", () => {
      expect(fmtBytes(1023.5)).toBe("1.00 KiB");
      expect(fmtBytes(KiB)).toBe("1.00 KiB");
      expect(fmtBytes(1.5 * KiB)).toBe("1.50 KiB");
      expect(fmtBytes(1023.994 * KiB)).toBe("1023.99 KiB");
    });

    it("should format MiB", () => {
      expect(fmtBytes(1023.995 * KiB)).toBe("1.00 MiB");
      expect(fmtBytes(MiB)).toBe("1.00 MiB");
      expect(fmtBytes(1.5 * MiB)).toBe("1.50 MiB");
      expect(fmtBytes(1023.98 * MiB)).toBe("1023.98 MiB");
      expect(fmtBytes(1023.994 * MiB)).toBe("1023.99 MiB");
    });

    it("should format GiB", () => {
      expect(fmtBytes(1023.995 * MiB)).toBe("1.00 GiB");
      expect(fmtBytes(GiB)).toBe("1.00 GiB");
      expect(fmtBytes(2.5 * GiB)).toBe("2.50 GiB");
      expect(fmtBytes(15.784 * GiB)).toBe("15.78 GiB");
      expect(fmtBytes(1023.994 * GiB)).toBe("1023.99 GiB");
    });

    it("should format TiB", () => {
      expect(fmtBytes(1023.995 * GiB)).toBe("1.00 TiB");
      expect(fmtBytes(1024 * GiB)).toBe("1.00 TiB");
      expect(fmtBytes(2.5 * TiB)).toBe("2.50 TiB");
      expect(fmtBytes(15.784 * TiB)).toBe("15.78 TiB");
    });
  });
});
