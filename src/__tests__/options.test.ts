// __tests__/options.test.ts

import { FsOptionsDefault, options } from "../options.js";
import { isWindows } from "../platform.js";

describe("options()", () => {
  it("should return default FsOptions when no overrides are provided", () => {
    const result = options();
    expect(result).toEqual(FsOptionsDefault);
  });

  it("should override timeoutMs when provided", () => {
    const override = { timeoutMs: 10000 };
    const result = options(override);
    expect(result.timeoutMs).toBe(override.timeoutMs);
    expect(result.excludedFileSystemTypes).toEqual(
      FsOptionsDefault.excludedFileSystemTypes,
    );
  });

  it("should override excludedFileSystemTypes when provided", () => {
    const override = { excludedFileSystemTypes: ["customfs"] };
    const result = options(override);
    expect(result.excludedFileSystemTypes).toEqual(
      override.excludedFileSystemTypes,
    );
    expect(result.timeoutMs).toBe(FsOptionsDefault.timeoutMs);
  });

  it("should override multiple fields when provided", () => {
    const overrides = {
      timeoutMs: 8000,
      linuxMountTablePath: "/etc/mtab",
      onlyDirectories: false,
    };
    const result = options(overrides);
    expect(result.timeoutMs).toBe(overrides.timeoutMs);
    expect(result.linuxMountTablePath).toBe(overrides.linuxMountTablePath);
    expect(result.onlyDirectories).toBe(overrides.onlyDirectories);
  });

  it("should throw a TypeError if overrides is not an object", () => {
    // @ts-expect-error Testing runtime validation
    expect(() => options(null)).toThrow(TypeError);
    // @ts-expect-error Testing runtime validation
    expect(() => options("invalid")).toThrow(TypeError);
  });

  it("should use correct default timeout based on platform", () => {
    const result = options();
    const expectedTimeout = isWindows ? 15000 : 5000;
    expect(result.timeoutMs).toBe(expectedTimeout);
  });

  it("should preserve default values for fields not overridden", () => {
    const override = { excludedMountPointGlobs: ["/custom/mount"] };
    const result = options(override);
    expect(result.excludedMountPointGlobs).toEqual(
      override.excludedMountPointGlobs,
    );
    expect(result.onlyDirectories).toBe(FsOptionsDefault.onlyDirectories);
  });
});
