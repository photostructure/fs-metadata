// src/options.test.ts

import { env } from "node:process";
import {
  getTimeoutMsDefault,
  OptionsDefault,
  optionsWithDefaults,
} from "./options";

describe("options()", () => {
  it("should return default FsOptions when no overrides are provided", () => {
    const result = optionsWithDefaults();
    expect(result).toEqual(OptionsDefault);
  });

  it("should override timeoutMs when provided", () => {
    const override = { timeoutMs: 10000 };
    const result = optionsWithDefaults(override);
    expect(result.timeoutMs).toBe(override.timeoutMs);
    expect(result.systemFsTypes).toEqual(OptionsDefault.systemFsTypes);
  });

  it("should override excludedFileSystemTypes when provided", () => {
    const override = { systemFsTypes: ["custom-fs"] };
    const result = optionsWithDefaults(override);
    expect(result.systemFsTypes).toEqual(override.systemFsTypes);
    expect(result.timeoutMs).toBe(OptionsDefault.timeoutMs);
  });

  it("should override multiple fields when provided", () => {
    const overrides = {
      timeoutMs: 8000,
      linuxMountTablePaths: ["/etc/mtab"],
      onlyDirectories: false,
    };
    const result = optionsWithDefaults(overrides);
    expect(result.timeoutMs).toBe(overrides.timeoutMs);
    expect(result.linuxMountTablePaths).toBe(overrides.linuxMountTablePaths);
  });

  it("should throw a TypeError if overrides is not an object", () => {
    // @ts-expect-error Testing runtime validation
    expect(() => optionsWithDefaults(null)).toThrow(TypeError);
    // @ts-expect-error Testing runtime validation
    expect(() => optionsWithDefaults("invalid")).toThrow(TypeError);
  });

  it("should preserve default values for fields not overridden", () => {
    const override = { systemPathPatterns: ["/custom/mount"] };
    const result = optionsWithDefaults(override);
    expect(result.systemPathPatterns).toEqual(override.systemPathPatterns);
    expect(result.systemFsTypes).toBe(OptionsDefault.systemFsTypes);
  });
});

describe("FS_METADATA_TIMEOUT_MS environment variable", () => {
  const originalValue = env["FS_METADATA_TIMEOUT_MS"];

  afterEach(() => {
    // Restore original env var
    if (originalValue === undefined) {
      delete env["FS_METADATA_TIMEOUT_MS"];
    } else {
      env["FS_METADATA_TIMEOUT_MS"] = originalValue;
    }
  });

  it("should use env var value when set to valid positive integer", () => {
    env["FS_METADATA_TIMEOUT_MS"] = "12345";
    expect(getTimeoutMsDefault()).toBe(12345);
  });

  it("should use default when env var is not set", () => {
    delete env["FS_METADATA_TIMEOUT_MS"];
    expect(getTimeoutMsDefault()).toBe(5000);
  });

  it("should use default when env var is invalid", () => {
    env["FS_METADATA_TIMEOUT_MS"] = "not-a-number";
    expect(getTimeoutMsDefault()).toBe(5000);
  });

  it("should use default when env var is zero or negative", () => {
    env["FS_METADATA_TIMEOUT_MS"] = "0";
    expect(getTimeoutMsDefault()).toBe(5000);

    env["FS_METADATA_TIMEOUT_MS"] = "-100";
    expect(getTimeoutMsDefault()).toBe(5000);
  });
});
